import { tenantDb } from "@pubcommand/db";
import { normalizeQuestion, type GapCandidate } from "../../../../../modules/support/gaps";

/**
 * Record gaps: one row per distinct question per brand, with a count. A question already
 * resolved that comes back is reopened (the record did not answer it after all).
 */
export async function recordGaps(input: {
  organizationId: string;
  brandId: string;
  profileId: string | null;
  source: "webhook" | "manual";
  conversationId?: string | null;
  actorId?: string | null;
  gaps: GapCandidate[];
}): Promise<{ added: number; repeated: number }> {
  const db = tenantDb(input.organizationId);
  let added = 0;
  let repeated = 0;
  for (const gap of input.gaps.slice(0, 50)) {
    const normalized = normalizeQuestion(gap.question);
    if (!normalized) continue;
    const existing = await db.supportGap.findFirst({ where: { brandId: input.brandId, normalized }, select: { id: true, count: true, status: true } });
    if (existing) {
      await db.supportGap.updateMany({
        where: { id: existing.id },
        data: { count: existing.count + 1, lastSeenAt: new Date(), ...(existing.status === "dismissed" ? {} : { status: "open", resolvedAt: null }) },
      });
      repeated += 1;
      continue;
    }
    await db.supportGap.create({
      data: {
        organizationId: input.organizationId,
        brandId: input.brandId,
        profileId: input.profileId,
        question: gap.question.slice(0, 500),
        normalized,
        reason: gap.reason.slice(0, 200),
        source: input.source,
        conversationId: input.conversationId?.slice(0, 200) ?? null,
        createdById: input.actorId ?? null,
      },
    });
    added += 1;
  }
  return { added, repeated };
}
