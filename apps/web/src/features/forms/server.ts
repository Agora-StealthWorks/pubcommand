import { runStructured } from "@pubcommand/ai";
import { brandProfile, brandPromptContext } from "@pubcommand/core";
import { tenantDb, type Prisma } from "@pubcommand/db";
import { createHash } from "node:crypto";
import { logAiUsage } from "../ai/usage";
import { teachBrain } from "../brain/teach";
import { formStats } from "../../../../../modules/forms/analytics";
import {
  MIN_RESPONSES_FOR_SUMMARY,
  SUMMARY_SCHEMA,
  SUMMARY_SYSTEM,
  brainNote,
  normalizeSummary,
  summaryPrompt,
  type FormSummaryResult,
} from "../../../../../modules/forms/summary";
import { loadResponses, rowToField } from "./data";

type BrandLike = { id: string; name: string; niche?: string | null; audience?: string | null; complianceNotes?: string | null };

const running = new Set<string>();

/**
 * Build the AI summary from AGGREGATES ONLY, store it, and teach the brand's
 * Brain the aggregates + summary. Runs after the request returns.
 */
export async function runFormSummary(input: { organizationId: string; formId: string; summaryId: string; brand: BrandLike; actorId: string | null }): Promise<void> {
  if (running.has(input.formId)) return;
  running.add(input.formId);
  const db = tenantDb(input.organizationId);
  const fail = (reason: string) => db.formSummary.updateMany({ where: { id: input.summaryId }, data: { status: "FAILED", error: reason } });
  try {
    const form = await db.form.findFirst({ where: { id: input.formId, deletedAt: null } });
    if (!form) return void (await fail("The form no longer exists."));
    const fields = (await db.formField.findMany({ where: { formId: form.id }, orderBy: { position: "asc" } })).map(rowToField);
    const stats = formStats(fields, await loadResponses(input.organizationId, form.id));
    if (stats.complete < MIN_RESPONSES_FOR_SUMMARY) {
      return void (await fail(`A summary needs at least ${MIN_RESPONSES_FOR_SUMMARY} complete responses. This form has ${stats.complete}.`));
    }
    const answer = await runStructured<FormSummaryResult>({
      system: SUMMARY_SYSTEM,
      input: [{ type: "text", text: summaryPrompt({ brandContext: brandPromptContext(brandProfile(input.brand)), formTitle: form.title, stats }) }],
      schema: SUMMARY_SCHEMA as unknown as Record<string, unknown>,
      effort: "medium",
      maxTokens: 8000,
    });
    if ("usage" in answer && answer.usage) {
      await logAiUsage({ organizationId: input.organizationId, moduleId: "forms", feature: "forms.summary", actorId: input.actorId, usage: answer.usage });
    }
    if (answer.status !== "ok") return void (await fail(answer.reason));
    const result = normalizeSummary(answer.data);
    await db.formSummary.updateMany({
      where: { id: input.summaryId },
      data: { status: "DONE", error: null, model: answer.usage.model, result: result as unknown as Prisma.InputJsonValue, responseCount: stats.complete },
    });
    if (form.brainSyncEnabled) {
      const note = brainNote({ formTitle: form.title, brandName: input.brand.name, stats, summary: result, generatedAt: new Date() });
      await teachBrain({
        organizationId: input.organizationId,
        brandId: form.brandId,
        sourceRef: `form:${form.id}`,
        title: note.title,
        body: note.body,
        folder: "Form results",
        source: "forms",
        actorId: input.actorId,
      });
    }
  } catch (error) {
    await fail(error instanceof Error ? error.message : "The summary failed.").catch(() => undefined);
  } finally {
    running.delete(input.formId);
  }
}

/** One-way salted hash of the client IP, for rate limiting. The raw IP is never stored. */
export function hashIp(ip: string | null): string | null {
  const salt = process.env.FORMS_IP_SALT || process.env.AUTH_SECRET;
  if (!ip || !salt) return null;
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 40);
}

export function clientIp(headers: Headers): string | null {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || null;
}

/** Simple per-IP limit: at most `max` responses started in the last 10 minutes. */
export async function rateLimited(organizationId: string, formId: string, ipHash: string | null, max = 20): Promise<boolean> {
  if (!ipHash) return false;
  const since = new Date(Date.now() - 10 * 60 * 1000);
  const count = await tenantDb(organizationId).formResponse.count({ where: { formId, ipHash, startedAt: { gte: since } } });
  return count >= max;
}
