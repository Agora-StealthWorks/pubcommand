import { runStructured } from "@pubcommand/ai";
import { appendOrgAudit, tenantDb, type Prisma } from "@pubcommand/db";
import { slugifyName } from "@pubcommand/core";
import {
  ANALYSIS_SCHEMA,
  ANALYSIS_SYSTEM,
  analysisPrompt,
  brainNote,
  normalizeAnalysis,
  overallScore,
  promoTypeFromPrice,
  readability,
  type PromoAnalysisResult,
} from "../../../../../modules/promo-studio/analysis";

/** Below this many characters of text, a PDF is treated as scanned and sent to the AI as a document. */
const SCANNED_PDF_TEXT_MIN = 800;
/** A run stuck this long (server restarted mid-run) is shown as interrupted. */
export const STALE_RUN_MS = 10 * 60 * 1000;

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

const running = new Set<string>();

/**
 * Run (or re-run) the AI analysis for one promo. Runs in the background after
 * the upload returns; the page polls until the status is DONE or FAILED.
 */
export async function runPromoAnalysis(input: {
  organizationId: string;
  promoId: string;
  brandName: string;
  actorId: string | null;
}): Promise<void> {
  const key = `${input.organizationId}:${input.promoId}`;
  if (running.has(key)) return;
  running.add(key);
  const db = tenantDb(input.organizationId);
  try {
    const promo = await db.promo.findFirst({ where: { id: input.promoId, deletedAt: null } });
    if (!promo) return;
    await db.promo.updateMany({ where: { id: promo.id }, data: { analysisStatus: "RUNNING", analysisError: null } });

    const parts: ({ type: "text"; text: string } | { type: "pdf"; base64: string; title?: string })[] = [];
    if (promo.inputType === "scanned-pdf") {
      const source = await db.promoFile.findFirst({ where: { promoId: promo.id, kind: "source" } });
      if (!source) throw new Error("The original PDF is missing. Upload it again.");
      parts.push({ type: "pdf", base64: Buffer.from(source.data).toString("base64"), title: promo.title });
    }
    const calibration = await db.promo.findMany({
      where: { brandId: promo.brandId, deletedAt: null, id: { not: promo.id }, trainingNotes: { not: null } },
      select: { title: true, trainingNotes: true, myScore: true, performanceScore: true },
      orderBy: { updatedAt: "desc" },
      take: 8,
    });
    const trainingNotes = calibration
      .filter((row) => row.trainingNotes?.trim())
      .map((row) => {
        const scores = [row.myScore != null ? `reviewer score ${row.myScore}` : "", row.performanceScore != null ? `real-world score ${row.performanceScore}` : ""].filter(Boolean).join(", ");
        return `${row.title}${scores ? ` (${scores})` : ""}: ${row.trainingNotes!.trim().slice(0, 400)}`;
      });
    parts.push({ type: "text", text: analysisPrompt({ brandName: input.brandName, title: promo.title, text: promo.sourceText, trainingNotes }) });

    const answer = await runStructured<PromoAnalysisResult>({
      system: ANALYSIS_SYSTEM,
      input: parts,
      schema: ANALYSIS_SCHEMA,
      effort: "high",
      maxTokens: 48000,
    });
    if (answer.status !== "ok") {
      if ("usage" in answer && answer.usage) await logUsage(input.organizationId, input.actorId, answer.usage);
      await db.promo.updateMany({ where: { id: promo.id }, data: { analysisStatus: "FAILED", analysisError: answer.reason } });
      return;
    }
    await logUsage(input.organizationId, input.actorId, answer.usage);

    const result = normalizeAnalysis(answer.data);
    const score = overallScore(result);
    const fk = promo.sourceText ? readability(promo.sourceText) : null;
    const version = (await db.promoAnalysis.count({ where: { promoId: promo.id } })) + 1;
    await db.promoAnalysis.create({
      data: {
        organizationId: input.organizationId,
        promoId: promo.id,
        version,
        model: answer.usage.model,
        result: result as unknown as Prisma.InputJsonValue,
        score,
        inputTokens: answer.usage.inputTokens,
        outputTokens: answer.usage.outputTokens,
        createdById: input.actorId,
      },
    });
    const price = result.detected.pricePoint;
    const detectedType = result.detected.promoType !== "Unknown" ? result.detected.promoType : promoTypeFromPrice(price);
    await db.promo.updateMany({
      where: { id: promo.id },
      data: {
        analysisStatus: "DONE",
        analysisError: null,
        effectivenessScore: score,
        fkReadingEase: fk?.ease ?? null,
        fkGradeLevel: fk?.grade ?? null,
        // Detected details fill blanks only; anything a person typed wins.
        publisher: promo.publisher || result.detected.publisher || null,
        gurus: promo.gurus.length ? promo.gurus : result.detected.gurus.filter(Boolean),
        product: promo.product || result.detected.product || null,
        promoType: promo.promoType || detectedType,
        pricePoint: promo.pricePoint ?? (price != null && Number.isFinite(price) ? price : null),
      },
    });
    await teachBrain({ organizationId: input.organizationId, brandId: promo.brandId, brandName: input.brandName, promoId: promo.id, title: promo.title, score, result, actorId: input.actorId });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "The analysis failed.";
    await db.promo.updateMany({ where: { id: input.promoId }, data: { analysisStatus: "FAILED", analysisError: reason } }).catch(() => undefined);
  } finally {
    running.delete(key);
  }
}

async function logUsage(organizationId: string, actorId: string | null, usage: { model: string; inputTokens: number; outputTokens: number }) {
  await tenantDb(organizationId)
    .aiUsageLog.create({
      data: {
        organizationId,
        moduleId: "promo-studio",
        feature: "promo.analyze",
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        createdById: actorId,
      },
    })
    .catch((error) => console.error("[ai-usage] could not log usage", error));
}

/** Write or refresh this promo's note in the brand's mini-brain. Soft-fails. */
async function teachBrain(input: {
  organizationId: string;
  brandId: string;
  brandName: string;
  promoId: string;
  title: string;
  score: number | null;
  result: PromoAnalysisResult;
  actorId: string | null;
}) {
  try {
    const db = tenantDb(input.organizationId);
    const note = brainNote({ title: input.title, brandName: input.brandName, score: input.score, result: input.result });
    const sourceRef = `promo:${input.promoId}`;
    const existing = await db.knowledgePage.findFirst({ where: { sourceRef } });
    if (existing) {
      await db.knowledgePage.updateMany({ where: { id: existing.id }, data: { title: note.title, body: note.body } });
      return;
    }
    const base = (slugifyName(note.title) || "promo-review").slice(0, 60);
    const taken = await db.knowledgePage.count({ where: { slug: { startsWith: base } } });
    await db.knowledgePage.create({
      data: {
        organizationId: input.organizationId,
        brandId: input.brandId,
        title: note.title,
        slug: taken ? `${base}-${input.promoId.slice(0, 8)}` : base,
        body: note.body,
        folder: "Promo reviews",
        source: "promo-analyzer",
        sourceRef,
        createdById: input.actorId,
      },
    });
    await appendOrgAudit(input.organizationId, { actorId: input.actorId, action: "brain.taught", targetType: "promo", targetId: input.promoId });
  } catch (error) {
    console.error("[brain] promo note failed", error);
  }
}

export function isStale(status: string, updatedAt: Date): boolean {
  return (status === "RUNNING" || status === "QUEUED") && Date.now() - updatedAt.getTime() > STALE_RUN_MS;
}
