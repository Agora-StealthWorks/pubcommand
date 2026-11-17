import { brandPromptContext, brandProfile } from "@pubcommand/core";
import { runStructured } from "@pubcommand/ai";
import { tenantDb, type Prisma } from "@pubcommand/db";
import { logAiUsage } from "../ai/usage";
import { AI_REVIEW_SCHEMA, AI_REVIEW_SYSTEM, aiReviewInput, type AiReview } from "../../../../../modules/testimonials/testimonials";
import type { BrandLike } from "./server";

/**
 * Optional AI pre-review: points out phrases that may break the brand's compliance
 * rules. It never decides; a person approves. Runs after the response (status column
 * ai_status), works without a key (status "unavailable" with the reason shown).
 */
export async function runAiPreReview(organizationId: string, brand: BrandLike, id: string, actorId: string | null): Promise<void> {
  const db = tenantDb(organizationId);
  const t = await db.testimonial.findFirst({ where: { id, brandId: brand.id, deletedAt: null }, select: { quote: true, body: true, resultClaimed: true, publicationId: true } });
  if (!t) return;
  const pub = t.publicationId ? await db.calendarPublication.findFirst({ where: { id: t.publicationId }, select: { name: true } }) : null;
  await db.testimonial.updateMany({ where: { id, brandId: brand.id }, data: { aiStatus: "running", aiReason: null } });
  const answer = await runStructured<AiReview>({
    system: AI_REVIEW_SYSTEM,
    input: [{ type: "text", text: aiReviewInput(brandPromptContext(brandProfile(brand)), { ...t, publication: pub?.name ?? null }) }],
    schema: AI_REVIEW_SCHEMA as unknown as Record<string, unknown>,
    effort: "low",
    maxTokens: 2000,
  });
  if ("usage" in answer && answer.usage) await logAiUsage({ organizationId, moduleId: "testimonials", feature: "testimonials.pre-review", actorId, usage: answer.usage });
  if (answer.status === "ok") {
    await db.testimonial.updateMany({ where: { id, brandId: brand.id }, data: { aiStatus: "done", aiReason: null, aiFlags: answer.data as unknown as Prisma.InputJsonValue } });
  } else {
    await db.testimonial.updateMany({ where: { id, brandId: brand.id }, data: { aiStatus: answer.status, aiReason: answer.reason } });
  }
}
