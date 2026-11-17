import { runStructured } from "@pubcommand/ai";
import type { Prisma } from "@pubcommand/db";
import { ASK_NOTE_LIMIT, ASK_SCHEMA, ASK_SYSTEM, askPrompt, normalizeAskAnswer, type AskAnswer, type AskAnswerRaw, type AskSource } from "../../../../../modules/knowledge/ask";
import { mainBrain } from "./db";
import { provenanceNames, searchMainNotes } from "./notes";

export const MAIN_SCOPE_LABEL = "Main Brain (platform)";

/**
 * Answer one stored main-Brain question in the background. Only main-Brain
 * notes are searched. AI usage is platform usage (no organization), so it is
 * not written to an organization's usage log.
 */
export async function runMainAsk(input: { questionId: string; actorId: string | null }): Promise<void> {
  try {
    const row = await mainBrain((tx) => tx.mainBrainQuestion.findUnique({ where: { id: input.questionId } }));
    if (!row) return;
    await mainBrain((tx) => tx.mainBrainQuestion.update({ where: { id: row.id }, data: { status: "RUNNING", error: null } }));
    const hits = await searchMainNotes({ query: row.question, mode: "any", limit: ASK_NOTE_LIMIT });
    if (hits.length === 0) {
      const empty: AskAnswer = { answer: "No main-Brain notes match that question yet.", answered: false, citations: [], consideredIds: [] };
      await mainBrain((tx) => tx.mainBrainQuestion.update({ where: { id: row.id }, data: { status: "DONE", answer: empty as unknown as Prisma.InputJsonValue } }));
      return;
    }
    const names = await provenanceNames();
    const notes = await mainBrain((tx) =>
      tx.mainBrainNote.findMany({ where: { deletedAt: null, id: { in: hits.map((hit) => hit.id) } }, select: { id: true, title: true, folder: true, body: true, originBrandId: true, originOrganizationId: true, source: true } }),
    );
    const byId = new Map(notes.map((note) => [note.id, note]));
    const sources: AskSource[] = hits.flatMap((hit) => {
      const note = byId.get(hit.id);
      if (!note) return [];
      const origin = note.originBrandId ? names.brands.get(note.originBrandId)?.name : note.originOrganizationId ? names.orgs.get(note.originOrganizationId)?.name : null;
      return [{ id: note.id, title: note.title, folder: note.folder, origin: origin ?? "Platform", body: note.body }];
    });
    const result = await runStructured<AskAnswerRaw>({
      system: ASK_SYSTEM,
      input: [{ type: "text", text: askPrompt({ question: row.question, scopeLabel: MAIN_SCOPE_LABEL, brandContext: null, sources }) }],
      schema: ASK_SCHEMA,
      effort: "medium",
      maxTokens: 8000,
    });
    if (result.status !== "ok") {
      if (result.status === "failed" && result.usage && row.askedById) await logPlatformUsage(row.askedById, result.usage);
      await mainBrain((tx) =>
        tx.mainBrainQuestion.update({
          where: { id: row.id },
          data: { status: "FAILED", error: result.reason, answer: { answer: "", answered: false, citations: [], consideredIds: sources.map((s) => s.id) } },
        }),
      );
      return;
    }
    if (row.askedById) await logPlatformUsage(row.askedById, result.usage);
    const answer = normalizeAskAnswer(result.data, sources);
    await mainBrain((tx) =>
      tx.mainBrainQuestion.update({ where: { id: row.id }, data: { status: "DONE", error: null, model: result.usage.model, answer: answer as unknown as Prisma.InputJsonValue } }),
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "The question could not be answered.";
    await mainBrain((tx) => tx.mainBrainQuestion.updateMany({ where: { id: input.questionId }, data: { status: "FAILED", error: reason } })).catch(() => undefined);
  }
}

/**
 * logAiUsage() writes to an organization's usage log, which that organization can
 * see. Main-Brain calls belong to no organization, so they are only logged here.
 * (Merge note: a platform-level usage table would be the place for these.)
 */
async function logPlatformUsage(actorId: string, usage: unknown): Promise<void> {
  console.info("[main-brain] ask usage", actorId, JSON.stringify(usage).slice(0, 300));
}
