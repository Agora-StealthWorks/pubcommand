import { runText, streamText, type AiInput } from "@pubcommand/ai";
import { brandProfile, brandPromptContext } from "@pubcommand/core";
import { tenantDb, type Prisma } from "@pubcommand/db";
import { logAiUsage } from "../ai/usage";
import { teachBrain } from "../brain/teach";
import { getEditors, getPublications, publicationPromptBlock } from "../pubsetup/read";
import { brandScope, scopeWhere } from "../../../../../modules/knowledge/visibility";
import { promoTypeFromPrice, readability } from "../../../../../modules/promo-studio/analysis";
import { rankNotes } from "../../../../../modules/promo-studio/packager";
import { parseAnalysis } from "../../../../../modules/promo-studio/parse";
import {
  ANALYSIS_SYSTEM,
  REEVALUATE_SYSTEM,
  analysisContext,
  analysisUserText,
  matchDirectory,
  reevaluatePrompt,
  type AnalysisContextInput,
  type CalibrationExample,
} from "../../../../../modules/promo-studio/prompt";
import { analysisDigest, brainNoteV2, buildStored, intelNote, isStoredV2, sourceCopyNote, type StoredAnalysisV2 } from "../../../../../modules/promo-studio/stored";

/** Below this many characters of text, a PDF is treated as scanned and sent to the AI as a document. */
const SCANNED_PDF_TEXT_MIN = 800;
/** A run whose row has not moved this long (server restarted mid-run) is shown as interrupted. */
export const STALE_RUN_MS = 10 * 60 * 1000;
/** How often the streamed answer so far is written to the promo row for the live view. */
const LIVE_SAVE_MS = 1200;
const ANALYSIS_MAX_TOKENS = 32000;

export type ExtractedSource = {
  text: string;
  inputType: "docx" | "pdf" | "scanned-pdf" | "text";
  file?: { filename: string; mimeType: string; data: Buffer };
};

export async function extractSource(file: File | null, pasted: string): Promise<ExtractedSource | { error: string }> {
  if (file && file.size > 0) {
    const data = Buffer.from(await file.arrayBuffer());
    const name = file.name.toLowerCase();
    if (name.endsWith(".docx")) {
      const mammoth = await import("mammoth");
      const { value } = await mammoth.extractRawText({ buffer: data });
      if (!value.trim()) return { error: "That Word file has no text in it." };
      return { text: value.trim(), inputType: "docx", file: { filename: file.name, mimeType: file.type || "application/vnd.openxmlformats-officedocument.wordprocessingml.document", data } };
    }
    if (name.endsWith(".pdf")) {
      const { extractText, getDocumentProxy } = await import("unpdf");
      let text = "";
      try {
        const pdf = await getDocumentProxy(new Uint8Array(data));
        const result = await extractText(pdf, { mergePages: true });
        text = (Array.isArray(result.text) ? result.text.join("\n") : result.text).trim();
      } catch {
        text = "";
      }
      const scanned = text.length < SCANNED_PDF_TEXT_MIN;
      return {
        text: scanned ? "" : text,
        inputType: scanned ? "scanned-pdf" : "pdf",
        file: { filename: file.name, mimeType: "application/pdf", data },
      };
    }
    if (name.endsWith(".txt") || name.endsWith(".md")) {
      return { text: data.toString("utf8").trim(), inputType: "text", file: { filename: file.name, mimeType: "text/plain", data } };
    }
    return { error: "Upload a .docx, .pdf or .txt file, or paste the copy." };
  }
  if (pasted.trim().length < 200) return { error: "Paste the full promo copy (at least a few paragraphs), or upload a file." };
  return { text: pasted.trim(), inputType: "text" };
}

type Brand = { id?: string; name: string; niche?: string | null; audience?: string | null; complianceNotes?: string | null };
type Db = ReturnType<typeof tenantDb>;
type PromoRow = NonNullable<Awaited<ReturnType<Db["promo"]["findFirst"]>>>;

/** Everything the prompt's context block needs, read from Publication Setup, past promos, lessons and the Brain. */
async function gatherContext(db: Db, organizationId: string, promo: PromoRow, brand: Brand, visual: boolean): Promise<AnalysisContextInput> {
  const [publications, editors] = await Promise.all([getPublications(organizationId, promo.brandId, { activeOnly: true }), getEditors(organizationId, promo.brandId, { activeOnly: true })]);
  const directory: AnalysisContextInput["directory"] = {
    publications: publications.map((p) => ({ code: p.code, name: p.name, editors: p.editors.map((e) => e.name) })),
    editors: editors.map((e) => ({ name: e.name, title: e.title, publications: e.publications.map((p) => p.name) })),
  };
  const matches = matchDirectory(`${promo.title}\n${promo.sourceText}`, directory);
  const matchedEditors = new Set(matches.flatMap((m) => m.editors));
  const editorProfiles = editors
    .filter((e) => matchedEditors.has(e.name))
    .slice(0, 3)
    .map((e) => ({
      name: e.name,
      profile: [e.title, e.shortBio ?? e.longBio, e.credentials ? `Credentials: ${e.credentials}` : "", e.trackRecord ? `Track record: ${e.trackRecord}` : "", e.specialties.length ? `Specialties: ${e.specialties.join(", ")}` : ""]
        .filter(Boolean)
        .join("\n"),
    }));
  const matchedPub = matches.find((m) => m.kind === "publication")?.name ?? matches[0]?.publications[0] ?? promo.product;

  const [trained, lessons, notes, publicationBlock] = await Promise.all([
    db.promo.findMany({
      where: {
        brandId: promo.brandId,
        deletedAt: null,
        id: { not: promo.id },
        OR: [{ trainingNotes: { not: null } }, { myScore: { not: null } }, { performanceScore: { not: null } }, { isBestPerformer: true }],
      },
      select: { id: true, title: true, gurus: true, publisher: true, product: true, promoType: true, trainingNotes: true, myScore: true, performanceScore: true, isBestPerformer: true },
      orderBy: { updatedAt: "desc" },
      take: 150,
    }),
    db.promoLesson.findMany({ where: { brandId: promo.brandId, hidden: false }, orderBy: [{ pinned: "desc" }, { evidenceCount: "desc" }], select: { title: true, body: true, pinned: true }, take: 60 }),
    db.knowledgePage.findMany({
      where: { AND: [scopeWhere(brandScope(promo.brandId)), { NOT: { folder: "Promo reviews" } }, { NOT: { sourceRef: { startsWith: "promo" } } }] },
      select: { title: true, body: true },
      orderBy: { updatedAt: "desc" },
      take: 80,
    }),
    matchedPub ? publicationPromptBlock(organizationId, promo.brandId, matchedPub).catch(() => "") : Promise.resolve(""),
  ]);
  const analyses = trained.length
    ? await db.promoAnalysis.findMany({ where: { promoId: { in: trained.map((t) => t.id) } }, orderBy: { version: "desc" }, select: { promoId: true, score: true, result: true } })
    : [];
  const latest = new Map<string, (typeof analyses)[number]>();
  for (const row of analyses) if (!latest.has(row.promoId)) latest.set(row.promoId, row);
  const calibration: CalibrationExample[] = trained.map((t) => {
    const a = latest.get(t.id);
    return {
      id: t.id,
      title: t.title,
      gurus: t.gurus,
      publisher: t.publisher,
      product: t.product,
      promoType: t.promoType,
      bigIdea: a ? (analysisDigest(a.result, brand.name)?.bigIdea ?? "") : "",
      predicted: a?.score ?? null,
      performance: t.performanceScore,
      myScore: t.myScore,
      notes: t.trainingNotes?.trim() ?? "",
      bestPerformer: t.isBestPerformer,
    };
  });
  const query = [promo.title, ...matches.map((m) => m.name), ...matches.flatMap((m) => m.publications)].join(" ");
  return {
    brandContext: brandPromptContext(brandProfile(brand)),
    directory,
    matches,
    publicationBlock,
    editorProfiles,
    calibration,
    lessons,
    brainNotes: rankNotes(notes, query, 3),
    visual,
    title: promo.title,
    runStartDate: promo.runStartDate ? promo.runStartDate.toISOString().slice(0, 10) : null,
    promoCode: promo.promoCode,
    known: { gurus: promo.gurus, promoType: promo.promoType, publisher: promo.publisher, product: promo.product },
  };
}

const running = new Set<string>();

/**
 * Run (or re-run) the analysis for one promo: one streamed answer in labelled
 * sections. It runs on the server, detached from any browser (after() or the
 * bulk queue), writing the answer so far to the promo row about once a second
 * so the page can show it live; closing the tab changes nothing. When it ends
 * the sections are parsed, scored in code and saved as a new PromoAnalysis
 * version, then the Brain is taught.
 */
export async function runPromoAnalysis(input: {
  organizationId: string;
  promoId: string;
  brand: Brand;
  actorId: string | null;
}): Promise<void> {
  const key = `${input.organizationId}:${input.promoId}`;
  if (running.has(key)) return;
  running.add(key);
  const db = tenantDb(input.organizationId);
  // The outcome lives on the promo row (status + error); the bulk queue reads it from there.
  const fail = async (reason: string) => {
    await db.promo.updateMany({ where: { id: input.promoId }, data: { analysisStatus: "FAILED", analysisError: reason.slice(0, 1000), analysisLive: null } }).catch(() => undefined);
  };
  try {
    const promo = await db.promo.findFirst({ where: { id: input.promoId, deletedAt: null } });
    if (!promo) return;
    await db.promo.updateMany({ where: { id: promo.id }, data: { analysisStatus: "RUNNING", analysisError: null, analysisLive: "", analysisStartedAt: new Date() } });

    // PDFs are read visually (layout, images); Word files and pasted copy are words only.
    const parts: AiInput[] = [];
    let visual = false;
    if (promo.inputType === "pdf" || promo.inputType === "scanned-pdf") {
      const source = await db.promoFile.findFirst({ where: { promoId: promo.id, kind: "source" } });
      if (source) {
        parts.push({ type: "pdf", base64: Buffer.from(source.data).toString("base64"), title: promo.title });
        visual = true;
      } else if (promo.inputType === "scanned-pdf") {
        return void (await fail("The original PDF is missing. Upload it again."));
      }
    }
    parts.push({ type: "text", text: analysisUserText({ text: promo.sourceText, visual }) });
    const context = await gatherContext(db, input.organizationId, promo, input.brand, visual);

    let lastSave = 0;
    let saving: Promise<unknown> = Promise.resolve();
    const answer = await streamText({
      system: ANALYSIS_SYSTEM,
      context: analysisContext(context),
      input: parts,
      effort: "high",
      maxTokens: ANALYSIS_MAX_TOKENS,
      onText: async (text) => {
        const now = Date.now();
        if (now - lastSave < LIVE_SAVE_MS) return;
        lastSave = now;
        saving = db.promo.updateMany({ where: { id: promo.id }, data: { analysisLive: text } }).catch(() => undefined);
        await saving;
      },
    });
    await saving;
    if (answer.status === "unavailable") return void (await fail(answer.reason));
    await logAiUsage({ organizationId: input.organizationId, moduleId: "promo-studio", feature: "promo.analyze", actorId: input.actorId, usage: answer.status === "failed" ? (answer.usage ?? { model: "claude-opus-5-5", inputTokens: 0, outputTokens: 0 }) : answer.usage });
    if (answer.status === "failed") return void (await fail(answer.reason));

    const stored = buildStored({ raw: answer.text, finished: answer.status === "ok", visual, matches: context.matches });
    if (Object.keys(stored.sections).length === 0) {
      return void (await fail(answer.status === "truncated" ? `${answer.reason} Try again.` : "The AI answer was not in the expected format. Try again."));
    }
    const parsed = parseAnalysis(stored.sections);
    const digest = analysisDigest(stored, input.brand.name)!;
    const score = stored.scorecard.final;
    const fk = promo.sourceText ? readability(promo.sourceText) : null;
    const version = (await db.promoAnalysis.count({ where: { promoId: promo.id } })) + 1;
    await db.promoAnalysis.create({
      data: {
        organizationId: input.organizationId,
        promoId: promo.id,
        version,
        model: answer.usage.model,
        result: stored as unknown as Prisma.InputJsonValue,
        score,
        inputTokens: answer.usage.inputTokens,
        outputTokens: answer.usage.outputTokens,
        createdById: input.actorId,
      },
    });
    const price = digest.detected.pricePoint;
    const detectedType = promoTypeFromPrice(price);
    await db.promo.updateMany({
      where: { id: promo.id },
      data: {
        analysisStatus: "DONE",
        analysisError: answer.status === "truncated" ? `${answer.reason} Sections it did not reach are marked; run it again for a full review.` : null,
        analysisLive: null,
        effectivenessScore: score,
        fkReadingEase: fk?.ease ?? null,
        fkGradeLevel: fk?.grade ?? null,
        // Detected details fill blanks only; anything a person typed wins. A code match beats the AI's guess (see detectedFrom).
        publisher: promo.publisher || digest.detected.publisher || null,
        gurus: promo.gurus.length ? promo.gurus : digest.detected.gurus.filter(Boolean),
        product: promo.product || digest.detected.product || null,
        promoType: promo.promoType || detectedType,
        pricePoint: promo.pricePoint ?? (price != null && Number.isFinite(price) ? price : null),
      },
    });
    // The detected type may move the promo into another results cohort.
    if (!promo.promoType && detectedType) await import("./insights").then((m) => m.retier(input.organizationId, promo.brandId)).catch(() => undefined);

    const meta = { publisher: promo.publisher || digest.detected.publisher, gurus: promo.gurus.length ? promo.gurus : digest.detected.gurus, product: promo.product || digest.detected.product, promoCode: promo.promoCode, analyzedAt: new Date() };
    await teachAnalysis({ organizationId: input.organizationId, brand: input.brand, promo, stored, fk, meta, intel: parsed.intel, score, actorId: input.actorId });
  } catch (error) {
    await fail(error instanceof Error ? error.message : "The analysis failed.");
  } finally {
    running.delete(key);
  }
}

/** Teach the brand's Brain: the review, the facts the promo states, and the promo's own copy. Soft-fails. */
async function teachAnalysis(input: {
  organizationId: string;
  brand: Brand;
  promo: PromoRow;
  stored: StoredAnalysisV2;
  fk: { ease: number; grade: number } | null;
  meta: { publisher?: string | null; gurus?: readonly string[]; product?: string | null; promoCode?: string | null; analyzedAt: Date };
  intel: ReturnType<typeof parseAnalysis>["intel"];
  score: number | null;
  actorId: string | null;
}): Promise<void> {
  const base = { organizationId: input.organizationId, brandId: input.promo.brandId, source: "promo-analyzer", actorId: input.actorId };
  const review = brainNoteV2({ title: input.promo.title, brandName: input.brand.name, stored: input.stored, fk: input.fk, meta: input.meta });
  await teachBrain({ ...base, sourceRef: `promo:${input.promo.id}`, title: review.title, body: review.body, folder: "Promo reviews" });
  const facts = intelNote({ title: input.promo.title, intel: input.intel, score: input.score, analyzedAt: input.meta.analyzedAt });
  if (facts) await teachBrain({ ...base, sourceRef: `promo-intel:${input.promo.id}`, title: facts.title, body: facts.body, folder: "Promo facts" });
  const copy = sourceCopyNote({
    title: input.promo.title,
    text: input.promo.sourceText,
    meta: [input.meta.publisher ? `Publisher: ${input.meta.publisher}` : "", input.meta.gurus?.length ? `Editor: ${input.meta.gurus.join(", ")}` : "", input.meta.promoCode ? `Promo code: ${input.meta.promoCode}` : "", input.score != null ? `Analyzer score: ${input.score.toFixed(1)}/10` : ""].filter(Boolean),
  });
  if (copy) await teachBrain({ ...base, sourceRef: `promo-copy:${input.promo.id}`, title: copy.title, body: copy.body, folder: "Promo copy" });
}

/** A re-evaluation stuck this long is shown as failed. */
export const STALE_REEVAL_MS = 5 * 60 * 1000;

/**
 * Re-score the eight dimensions with the publisher's training feedback (the
 * Training tab's Re-evaluate). The proposal is saved on the current analysis
 * for the person to apply or ignore; applying it changes the shown score.
 */
export async function runReevaluation(input: { organizationId: string; promoId: string; brand: Brand; actorId: string | null }): Promise<void> {
  const db = tenantDb(input.organizationId);
  const row = await db.promoAnalysis.findFirst({ where: { promoId: input.promoId }, orderBy: { version: "desc" } });
  const promo = await db.promo.findFirst({ where: { id: input.promoId, deletedAt: null } });
  if (!row || !promo || !isStoredV2(row.result)) return;
  const stored = row.result;
  const save = (reevaluation: StoredAnalysisV2["reevaluation"]) =>
    db.promoAnalysis.updateMany({ where: { id: row.id }, data: { result: { ...stored, reevaluation } as unknown as Prisma.InputJsonValue } });
  const startedAt = new Date().toISOString();
  await save({ status: "RUNNING", startedAt });
  const strongSignal = promo.isBestPerformer || (promo.performanceScore != null && promo.performanceScore >= 9);
  const answer = await runText({
    system: REEVALUATE_SYSTEM,
    prompt: reevaluatePrompt({
      brandContext: brandPromptContext(brandProfile(input.brand)),
      scorecardText: stored.calibrated?.text ?? stored.sections.SCORECARD ?? "",
      promoType: promo.promoType,
      performance: promo.performanceScore,
      myScore: promo.myScore,
      notes: promo.trainingNotes ?? "",
      strongSignal,
    }),
    effort: "high",
    maxTokens: 8000,
  });
  if (answer.status === "ok") await logAiUsage({ organizationId: input.organizationId, moduleId: "promo-studio", feature: "promo.reevaluate", actorId: input.actorId, usage: answer.usage });
  await save(answer.status === "ok" && answer.text.trim() ? { status: "DONE", startedAt, text: answer.text.trim() } : { status: "FAILED", startedAt, error: answer.status === "ok" ? "The AI returned nothing." : answer.reason });
}

export function isStale(status: string, updatedAt: Date): boolean {
  return (status === "RUNNING" || status === "QUEUED") && Date.now() - updatedAt.getTime() > STALE_RUN_MS;
}
