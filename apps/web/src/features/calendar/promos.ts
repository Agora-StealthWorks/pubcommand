import { tenantDb } from "@pubcommand/db";
import { toDay } from "../../../../../modules/editorial/dates";
import { UUID } from "./context";

export type PromoPick = { id: string; title: string; promoStatus: string | null; stage: string | null; product: string | null };

/** Promo Analyzer promos of a brand with their pipeline stage, newest first. */
export async function listPromos(organizationId: string, brandId: string, take = 500): Promise<PromoPick[]> {
  const db = tenantDb(organizationId);
  const [promos, tracks] = await Promise.all([
    db.promo.findMany({ where: { brandId, deletedAt: null }, orderBy: { createdAt: "desc" }, take, select: { id: true, title: true, promoStatus: true, product: true } }),
    db.calendarPromoTrack.findMany({ where: { brandId }, select: { promoId: true, stage: true } }),
  ]);
  const stage = new Map(tracks.map((t) => [t.promoId, t.stage]));
  return promos.map((p) => ({ ...p, stage: stage.get(p.id) ?? null }));
}

/** One promo of the brand, or null. */
export async function findPromo(organizationId: string, brandId: string, id: string | null | undefined) {
  if (!id || !UUID.test(id)) return null;
  const db = tenantDb(organizationId);
  const promo = await db.promo.findFirst({ where: { id, brandId, deletedAt: null }, select: { id: true, title: true, promoStatus: true, product: true, gurus: true } });
  if (!promo) return null;
  const track = await db.calendarPromoTrack.findFirst({ where: { promoId: id } });
  return { ...promo, stage: track?.stage ?? null, launchDate: toDay(track?.launchDate), writers: track?.writers ?? [], notes: track?.notes ?? null };
}

export type LinkedPromo = NonNullable<Awaited<ReturnType<typeof findPromo>>>;

/** Set a promo's pipeline stage, creating its track row when it has none. Returns the previous stage. */
export async function setPromoStage(input: { organizationId: string; brandId: string; promoId: string; stage: string; actorId: string | null }): Promise<string | null> {
  const db = tenantDb(input.organizationId);
  const existing = await db.calendarPromoTrack.findFirst({ where: { promoId: input.promoId } });
  if (existing) {
    await db.calendarPromoTrack.updateMany({ where: { id: existing.id }, data: { stage: input.stage, updatedById: input.actorId } });
    return existing.stage;
  }
  await db.calendarPromoTrack.create({ data: { organizationId: input.organizationId, brandId: input.brandId, promoId: input.promoId, stage: input.stage, updatedById: input.actorId } });
  return null;
}
