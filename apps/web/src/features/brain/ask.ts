import { runStructured } from "@pubcommand/ai";
import { tenantDb, type Prisma } from "@pubcommand/db";
import { logAiUsage } from "../ai/usage";
import {
  ASK_NOTE_LIMIT,
  ASK_SCHEMA,
  ASK_SYSTEM,
  askPrompt,
  normalizeAskAnswer,
  type AskAnswer,
  type AskAnswerRaw,
  type AskSource,
} from "../../../../../modules/knowledge/ask";
import { originLabel, scopeWhere, type BrainScope } from "../../../../../modules/knowledge/visibility";
import { searchNotes } from "./search";

export const STALE_ASK_MS = 5 * 60 * 1000;

/**
 * Answer one stored question in the background. Only notes visible in the
 * brand's Brain are searched and sent to the AI.
 */
export async function runAsk(input: {
  organizationId: string;
  questionId: string;
  scope: BrainScope;
  scopeLabel: string;
  brandContext: string;
  brandNames: Map<string, string>;
  actorId: string | null;
}): Promise<void> {
  const db = tenantDb(input.organizationId);
  try {
    const row = await db.knowledgeQuestion.findFirst({ where: { id: input.questionId } });
    if (!row) return;
    await db.knowledgeQuestion.updateMany({ where: { id: row.id }, data: { status: "RUNNING", error: null } });

    const hits = await searchNotes({ organizationId: input.organizationId, scope: input.scope, query: row.question, mode: "any", limit: ASK_NOTE_LIMIT });
    if (hits.length === 0) {
      const empty: AskAnswer = { answer: "No notes in this Brain match that question yet.", answered: false, citations: [], consideredIds: [] };
      await db.knowledgeQuestion.updateMany({ where: { id: row.id }, data: { status: "DONE", answer: empty as unknown as Prisma.InputJsonValue } });
      return;
    }
    // Load bodies through the same visibility rule (belt and braces on top of the search filter).
    const notes = await db.knowledgePage.findMany({
      where: { AND: [scopeWhere(input.scope), { id: { in: hits.map((hit) => hit.id) } }] },
      select: { id: true, title: true, folder: true, brandId: true, body: true },
    });
    const byId = new Map(notes.map((note) => [note.id, note]));
    const sources: AskSource[] = hits.flatMap((hit) => {
      const note = byId.get(hit.id);
      return note ? [{ id: note.id, title: note.title, folder: note.folder, origin: originLabel(note, input.brandNames), body: note.body }] : [];
    });

    const result = await runStructured<AskAnswerRaw>({
      system: ASK_SYSTEM,
      input: [{ type: "text", text: askPrompt({ question: row.question, scopeLabel: input.scopeLabel, brandContext: input.brandContext, sources }) }],
      schema: ASK_SCHEMA,
      effort: "medium",
      maxTokens: 8000,
    });
    if (result.status !== "ok") {
      if (result.status === "failed" && result.usage) {
        await logAiUsage({ organizationId: input.organizationId, moduleId: "knowledge", feature: "knowledge.ask", actorId: input.actorId, usage: result.usage });
      }
      await db.knowledgeQuestion.updateMany({
        where: { id: row.id },
        data: { status: "FAILED", error: result.reason, answer: { answer: "", answered: false, citations: [], consideredIds: sources.map((s) => s.id) } },
      });
      return;
    }
    await logAiUsage({ organizationId: input.organizationId, moduleId: "knowledge", feature: "knowledge.ask", actorId: input.actorId, usage: result.usage });
    const answer = normalizeAskAnswer(result.data, sources);
    await db.knowledgeQuestion.updateMany({
      where: { id: row.id },
      data: { status: "DONE", error: null, model: result.usage.model, answer: answer as unknown as Prisma.InputJsonValue },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "The question could not be answered.";
    await db.knowledgeQuestion.updateMany({ where: { id: input.questionId }, data: { status: "FAILED", error: reason } }).catch(() => undefined);
  }
}
