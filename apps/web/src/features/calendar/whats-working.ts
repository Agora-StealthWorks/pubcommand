import { runStructured } from "@pubcommand/ai";
import { brandProfile, brandPromptContext } from "@pubcommand/core";
import { tenantDb, type Prisma } from "@pubcommand/db";
import { countFrom } from "../../../../../modules/editorial/analytics";
import { addDays, fromDay, todayIn } from "../../../../../modules/editorial/dates";
import {
  normalizeWhatsWorking,
  WHATS_WORKING_SCHEMA,
  WHATS_WORKING_SYSTEM,
  whatsWorkingFacts,
  whatsWorkingPrompt,
  type WhatsWorkingAi,
  type WorkingSend,
} from "../../../../../modules/editorial/whats-working";
import { logAiUsage } from "../ai/usage";
import { loadSendStats } from "./data";

export const WINDOW_DAYS = 30;
const STALE_MS = 10 * 60 * 1000;

export function isStale(status: string, updatedAt: Date): boolean {
  return (status === "QUEUED" || status === "RUNNING") && Date.now() - updatedAt.getTime() > STALE_MS;
}

/**
 * Compute the facts from the data, store them, then ask the AI to explain them.
 * Without an AI key the facts still show; the page says why there is no write-up.
 */
export async function runWhatsWorking(input: {
  organizationId: string;
  brand: { id: string; name: string; niche?: string | null; audience?: string | null; complianceNotes?: string | null };
  insightId: string;
  actorId: string | null;
}): Promise<void> {
  const db = tenantDb(input.organizationId);
  try {
    await db.calendarInsight.updateMany({ where: { id: input.insightId }, data: { status: "RUNNING", error: null } });
    const today = todayIn();
    const stats = await loadSendStats(input.organizationId, input.brand.id);
    const sends: WorkingSend[] = stats
      .filter((s) => s.mailDate && s.delivered)
      .map((s) => ({
        issueId: s.issueId,
        title: s.title,
        pub: s.pubCode,
        day: s.mailDate!,
        issueType: s.issueType,
        writer: s.writer,
        subject: s.subject,
        mailed: s.delivered ?? 0,
        opens: countFrom(s.openRate, s.delivered, s.totalOpened),
        clicks: countFrom(s.clickRate, s.delivered, s.totalClicked),
        revenue: s.revenue ?? 0,
      }));
    const facts = whatsWorkingFacts(sends, today, WINDOW_DAYS);
    await db.calendarInsight.updateMany({
      where: { id: input.insightId },
      data: { facts: facts as unknown as Prisma.InputJsonValue, issueCount: facts.sends, dataFrom: fromDay(facts.from), dataTo: fromDay(addDays(today, 0)) },
    });
    if (facts.sends === 0) {
      await db.calendarInsight.updateMany({ where: { id: input.insightId }, data: { status: "FAILED", error: `No send stats in the last ${WINDOW_DAYS} days. Import an ESP export first.` } });
      return;
    }
    const answer = await runStructured<WhatsWorkingAi>({
      system: WHATS_WORKING_SYSTEM,
      input: [{ type: "text", text: whatsWorkingPrompt(facts, brandPromptContext(brandProfile(input.brand))) }],
      schema: WHATS_WORKING_SCHEMA as unknown as Record<string, unknown>,
      effort: "medium",
      maxTokens: 8000,
    });
    if (answer.status !== "ok") {
      if ("usage" in answer && answer.usage) await logAiUsage({ organizationId: input.organizationId, moduleId: "editorial", feature: "calendar.whats-working", actorId: input.actorId, usage: answer.usage });
      await db.calendarInsight.updateMany({ where: { id: input.insightId }, data: { status: "FAILED", error: answer.reason } });
      return;
    }
    await logAiUsage({ organizationId: input.organizationId, moduleId: "editorial", feature: "calendar.whats-working", actorId: input.actorId, usage: answer.usage });
    const content = normalizeWhatsWorking(answer.data, facts);
    await db.calendarInsight.updateMany({
      where: { id: input.insightId },
      data: { status: "DONE", error: null, model: answer.usage.model, content: content as unknown as Prisma.InputJsonValue },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "The summary failed.";
    await db.calendarInsight.updateMany({ where: { id: input.insightId }, data: { status: "FAILED", error: reason } }).catch(() => undefined);
  }
}
