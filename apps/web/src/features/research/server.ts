import { runStructured } from "@pubcommand/ai";
import { brandProfile, brandPromptContext } from "@pubcommand/core";
import { tenantDb, type Prisma } from "@pubcommand/db";
import { logAiUsage } from "../ai/usage";
import { teachBrain } from "../brain/teach";
import {
  applyGrouping,
  brainNote,
  describeFailure,
  EXTRACTION_SCHEMA,
  EXTRACTION_SYSTEM,
  extractionPrompt,
  extractionProblem,
  GROUPING_SCHEMA,
  GROUPING_SYSTEM,
  groupingPrompt,
  MAX_CARDS,
  normalizeExtraction,
  normalizeKeyPoints,
  type ExtractionResult,
  type GroupingResult,
} from "../../../../../modules/research/extract";
import { CONDENSE_MAX_INPUT, CONDENSE_MIN_CARDS, CONDENSE_SCHEMA, CONDENSE_SYSTEM, condensePrompt, condenseTarget, planCondense, relinkPlan, type CondenseAnswer, type CondenseInputCard } from "../../../../../modules/research/condense";
import { nextPosition } from "../../../../../modules/research/outline";

type Brand = { name: string; niche?: string | null; audience?: string | null; complianceNotes?: string | null };
type RunInput = { organizationId: string; projectId: string; brand: Brand; actorId: string | null };

/** Sized for 15 in-depth cards with their quotes; a cut-off answer is reported, never saved half-done. */
const EXTRACT_MAX_TOKENS = 32_000;
const running = new Set<string>();

const SOURCE_KIND_LABEL: Record<string, string> = { text: "pasted text", url: "web page", file: "uploaded file", youtube: "video transcript", x: "X (Twitter) post or thread" };

/**
 * Extract index cards from one source. Runs after the response; the page
 * polls until the source is DONE or FAILED. Re-running replaces that source's
 * AI cards (manual cards and cards already on the outline are kept).
 */
export async function runExtraction(input: RunInput & { sourceId: string }): Promise<void> {
  const key = `source:${input.sourceId}`;
  if (running.has(key)) return;
  running.add(key);
  const db = tenantDb(input.organizationId);
  try {
    const [project, source] = await Promise.all([
      db.researchProject.findFirst({ where: { id: input.projectId, deletedAt: null }, select: { id: true, name: true, description: true, shareWithBrain: true, brandId: true } }),
      db.researchSource.findFirst({ where: { id: input.sourceId, projectId: input.projectId } }),
    ]);
    if (!project || !source) return;
    await db.researchSource.updateMany({ where: { id: source.id }, data: { status: "RUNNING", error: null } });

    const parts: ({ type: "text"; text: string } | { type: "pdf"; base64: string; title?: string })[] = [];
    if (source.inputType === "scanned-pdf") {
      const file = await db.researchFile.findFirst({ where: { sourceId: source.id }, select: { data: true } });
      if (!file) throw new Error("The original PDF is missing. Upload it again.");
      parts.push({ type: "pdf", base64: Buffer.from(file.data).toString("base64"), title: source.title });
    }
    parts.push({
      type: "text",
      text: extractionPrompt({
        brandContext: brandPromptContext(brandProfile(input.brand)),
        projectName: project.name,
        projectBrief: project.description,
        sourceTitle: source.title,
        sourceKind: SOURCE_KIND_LABEL[source.kind] ?? source.kind,
        text: source.inputType === "scanned-pdf" ? null : source.rawText,
      }),
    });

    const answer = await runStructured<ExtractionResult>({ system: EXTRACTION_SYSTEM, input: parts, schema: EXTRACTION_SCHEMA, effort: "medium", maxTokens: EXTRACT_MAX_TOKENS });
    if ("usage" in answer && answer.usage) {
      await logAiUsage({ organizationId: input.organizationId, moduleId: "research", feature: "research.extract", actorId: input.actorId, usage: answer.usage });
    }
    if (answer.status !== "ok") {
      await db.researchSource.updateMany({ where: { id: source.id }, data: { status: "FAILED", error: describeFailure(answer.reason) } });
      return;
    }
    const result = normalizeExtraction(answer.data);
    const problem = extractionProblem(result);
    if (problem) {
      await db.researchSource.updateMany({ where: { id: source.id }, data: { status: "FAILED", error: problem } });
      return;
    }

    // Replace this source's earlier AI cards unless someone already used them in the outline.
    const old = await db.researchCard.findMany({ where: { sourceId: source.id, origin: "ai" }, select: { id: true, _count: { select: { bullets: true } } } });
    const removable = old.filter((card) => card._count.bullets === 0).map((card) => card.id);
    if (removable.length) await db.researchCard.deleteMany({ where: { id: { in: removable } } });

    const existing = await db.researchCard.findMany({ where: { projectId: project.id }, select: { id: true, position: true } });
    let position = nextPosition(existing);
    const sourceUrl = source.sourceRef && /^https?:\/\//.test(source.sourceRef) ? source.sourceRef : null;
    const sourceLabel = (result.sourceTitle && source.title === source.sourceRef ? result.sourceTitle : source.title).slice(0, 200);
    for (const card of result.cards.slice(0, MAX_CARDS)) {
      await db.researchCard.create({
        data: {
          organizationId: input.organizationId,
          projectId: project.id,
          sourceId: source.id,
          topic: card.topic,
          summary: card.summary,
          details: card.details,
          cardType: card.cardType,
          keyPoints: card.keyPoints as unknown as Prisma.InputJsonValue,
          tags: card.tags,
          sourceLabel,
          sourceUrl,
          position: position++,
          origin: "ai",
          createdById: input.actorId,
        },
      });
    }
    await db.researchSource.updateMany({
      where: { id: source.id },
      data: { status: "DONE", error: null, summary: result.sourceSummary || null, cardCount: result.cards.length },
    });
    await db.researchProject.updateMany({ where: { id: project.id }, data: { updatedAt: new Date() } });
    if (project.shareWithBrain) await refreshBrainNote({ ...input, actorId: input.actorId });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "The extraction failed.";
    await db.researchSource.updateMany({ where: { id: input.sourceId }, data: { status: "FAILED", error: reason } }).catch(() => undefined);
  } finally {
    running.delete(key);
  }
}

/** "Suggest topic groups": the AI sorts the project's cards into named piles. */
export async function runGrouping(input: RunInput): Promise<void> {
  const key = `group:${input.projectId}`;
  if (running.has(key)) return;
  running.add(key);
  const db = tenantDb(input.organizationId);
  try {
    const project = await db.researchProject.findFirst({ where: { id: input.projectId, deletedAt: null }, select: { id: true, name: true, shareWithBrain: true } });
    if (!project) return;
    await db.researchProject.updateMany({ where: { id: project.id }, data: { groupStatus: "RUNNING", groupError: null } });
    const cards = await db.researchCard.findMany({ where: { projectId: project.id }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true, topic: true, summary: true, tags: true } });
    if (cards.length < 2) {
      await db.researchProject.updateMany({ where: { id: project.id }, data: { groupStatus: "FAILED", groupError: "Add at least two cards before grouping." } });
      return;
    }
    const answer = await runStructured<GroupingResult>({
      system: GROUPING_SYSTEM,
      input: [{ type: "text", text: groupingPrompt({ brandContext: brandPromptContext(brandProfile(input.brand)), projectName: project.name, cards }) }],
      schema: GROUPING_SCHEMA,
      effort: "low",
      maxTokens: 8000,
    });
    if ("usage" in answer && answer.usage) {
      await logAiUsage({ organizationId: input.organizationId, moduleId: "research", feature: "research.group", actorId: input.actorId, usage: answer.usage });
    }
    if (answer.status !== "ok") {
      await db.researchProject.updateMany({ where: { id: project.id }, data: { groupStatus: "FAILED", groupError: describeFailure(answer.reason) } });
      return;
    }
    const assigned = applyGrouping(cards.map((card) => card.id), answer.data);
    for (const [cardId, groupName] of assigned) await db.researchCard.updateMany({ where: { id: cardId }, data: { groupName } });
    await db.researchProject.updateMany({ where: { id: project.id }, data: { groupStatus: "DONE", groupError: null } });
    if (project.shareWithBrain) await refreshBrainNote(input);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Grouping failed.";
    await db.researchProject.updateMany({ where: { id: input.projectId }, data: { groupStatus: "FAILED", groupError: reason } }).catch(() => undefined);
  } finally {
    running.delete(key);
  }
}

export const brainSourceRef = (projectId: string) => `research-project:${projectId}`;

/** Write or refresh the project's single Brain note. Only called when the project opts in. */
export async function refreshBrainNote(input: RunInput): Promise<void> {
  const db = tenantDb(input.organizationId);
  const project = await db.researchProject.findFirst({ where: { id: input.projectId, deletedAt: null, shareWithBrain: true } });
  if (!project) return;
  const [sources, cards] = await Promise.all([
    db.researchSource.findMany({ where: { projectId: project.id, status: "DONE" }, orderBy: { createdAt: "asc" }, select: { title: true, sourceRef: true } }),
    db.researchCard.findMany({ where: { projectId: project.id }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], take: 200 }),
  ]);
  const note = brainNote({
    projectName: project.name,
    description: project.description,
    brandName: input.brand.name,
    sources,
    cards: cards.map((card) => ({ topic: card.topic, summary: card.summary, groupName: card.groupName, keyPoints: normalizeKeyPoints(card.keyPoints), sourceLabel: card.sourceLabel })),
  });
  await teachBrain({
    organizationId: input.organizationId,
    brandId: project.brandId,
    sourceRef: brainSourceRef(project.id),
    title: note.title,
    body: note.body,
    folder: "Research",
    source: "research-extractor",
    actorId: input.actorId,
  });
}

/** Turning sharing off removes the note this project wrote (and nothing else). */
export async function removeBrainNote(organizationId: string, projectId: string): Promise<void> {
  await tenantDb(organizationId)
    .knowledgePage.deleteMany({ where: { sourceRef: brainSourceRef(projectId), source: "research-extractor" } })
    .catch((error) => console.error("[research] could not remove Brain note", error));
}

/**
 * Condense a set of cards (one group, or the whole project) into fewer,
 * denser cards. Key points are only kept when copied from the originals.
 * With `replace`, the originals go and their outline links move to the card
 * that absorbed them; otherwise the new cards are added alongside.
 */
export async function runCondense(input: RunInput & { scope: string | null; target: number | null; replace: boolean }): Promise<void> {
  const key = `condense:${input.projectId}`;
  if (running.has(key)) return;
  running.add(key);
  const db = tenantDb(input.organizationId);
  const fail = (reason: string) => db.researchProject.updateMany({ where: { id: input.projectId }, data: { condenseStatus: "FAILED", condenseError: reason } }).catch(() => undefined);
  try {
    const project = await db.researchProject.findFirst({ where: { id: input.projectId, deletedAt: null }, select: { id: true, name: true, shareWithBrain: true } });
    if (!project) return;
    await db.researchProject.updateMany({ where: { id: project.id }, data: { condenseStatus: "RUNNING", condenseError: null } });
    const where = input.scope === "__none" ? { projectId: project.id, groupName: null } : input.scope ? { projectId: project.id, groupName: input.scope } : { projectId: project.id };
    const rows = await db.researchCard.findMany({ where, orderBy: [{ position: "asc" }, { createdAt: "asc" }], take: CONDENSE_MAX_INPUT });
    if (rows.length < CONDENSE_MIN_CARDS) return void (await fail(`Condense needs at least ${CONDENSE_MIN_CARDS} cards in the set.`));
    const cards: CondenseInputCard[] = rows.map((row) => ({
      id: row.id,
      topic: row.topic,
      summary: row.summary,
      details: row.details,
      cardType: row.cardType,
      keyPoints: normalizeKeyPoints(row.keyPoints),
      tags: row.tags,
      sourceLabel: row.sourceLabel,
      sourceUrl: row.sourceUrl,
      groupName: row.groupName,
    }));
    const target = condenseTarget(cards.length, input.target);
    const answer = await runStructured<CondenseAnswer>({
      system: CONDENSE_SYSTEM,
      input: [{ type: "text", text: condensePrompt({ brandContext: brandPromptContext(brandProfile(input.brand)), projectName: project.name, cards, target }) }],
      schema: CONDENSE_SCHEMA,
      effort: "medium",
      maxTokens: EXTRACT_MAX_TOKENS,
    });
    if ("usage" in answer && answer.usage) {
      await logAiUsage({ organizationId: input.organizationId, moduleId: "research", feature: "research.condense", actorId: input.actorId, usage: answer.usage });
    }
    if (answer.status !== "ok") return void (await fail(describeFailure(answer.reason)));
    const plan = planCondense(cards, answer.data);
    if (plan.problem) return void (await fail(plan.problem));

    const first = Math.min(...rows.map((row) => row.position));
    const existing = await db.researchCard.findMany({ where: { projectId: project.id }, select: { id: true, position: true } });
    let position = input.replace ? first : nextPosition(existing);
    const created: { newId: string; fromIds: string[] }[] = [];
    for (const card of plan.cards) {
      const row = await db.researchCard.create({
        data: {
          organizationId: input.organizationId,
          projectId: project.id,
          sourceId: null,
          topic: card.topic,
          summary: card.summary,
          details: card.details,
          cardType: card.cardType,
          keyPoints: card.keyPoints as unknown as Prisma.InputJsonValue,
          tags: card.tags,
          sourceLabel: card.sourceLabel,
          sourceUrl: card.sourceUrl,
          groupName: card.groupName ?? (input.scope && input.scope !== "__none" ? input.scope : null),
          position: position++,
          origin: "condensed",
          condensedFrom: card.fromIds,
          createdById: input.actorId,
        },
      });
      created.push({ newId: row.id, fromIds: card.fromIds });
    }
    if (input.replace) {
      const absorbed = created.flatMap((c) => c.fromIds);
      const links = await db.researchBulletCard.findMany({ where: { cardId: { in: absorbed } }, select: { bulletId: true, cardId: true, position: true } });
      for (const link of relinkPlan(created, links)) {
        const exists = await db.researchBulletCard.findFirst({ where: { bulletId: link.bulletId, cardId: link.cardId }, select: { id: true } });
        if (!exists) await db.researchBulletCard.create({ data: { organizationId: input.organizationId, projectId: project.id, bulletId: link.bulletId, cardId: link.cardId, position: link.position } });
      }
      await db.researchCard.deleteMany({ where: { id: { in: absorbed }, projectId: project.id } });
    }
    await db.researchProject.updateMany({ where: { id: project.id }, data: { condenseStatus: "DONE", condenseError: null, updatedAt: new Date() } });
    if (project.shareWithBrain) await refreshBrainNote(input);
  } catch (error) {
    await fail(error instanceof Error ? error.message : "Condensing failed.");
  } finally {
    running.delete(key);
  }
}
