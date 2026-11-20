import { tenantDb } from "@pubcommand/db";
import { promoBrainNote } from "../../../../../modules/editorial/brain";
import { fromDay, toDay } from "../../../../../modules/editorial/dates";
import { planLaunchEvent, type ActivityEntry } from "../../../../../modules/editorial/promos";
import { teachBrain } from "../brain/teach";
import { UUID } from "./context";

/**
 * The Calendar's own promos (calendar_promos). Nothing here reads or writes Promo Analyzer.
 */

export type PromoPick = { id: string; name: string; stage: string; product: string | null };

/** The brand's live promos for pickers and the board, newest first. */
export async function listPromos(organizationId: string, brandId: string, take = 500) {
  const rows = await tenantDb(organizationId).calendarPromo.findMany({
    where: { brandId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, name: true, stage: true, product: true, promoType: true, format: true, writers: true, launchDate: true, launchEstimated: true, targetedDate: true },
  });
  return rows.map((r) => ({ ...r, launchDate: toDay(r.launchDate), targetedDate: toDay(r.targetedDate) }));
}

export type PromoRow = Awaited<ReturnType<typeof listPromos>>[number];

/** One live promo of the brand, or null. */
export async function findPromo(organizationId: string, brandId: string, id: string | null | undefined) {
  if (!id || !UUID.test(id)) return null;
  const row = await tenantDb(organizationId).calendarPromo.findFirst({ where: { id, brandId, deletedAt: null } });
  if (!row) return null;
  return { ...row, launchDate: toDay(row.launchDate), targetedDate: toDay(row.targetedDate) };
}

export type LoadedPromo = NonNullable<Awaited<ReturnType<typeof findPromo>>>;

/** Append history entries for a promo. Soft-fails: history never breaks a save. */
export async function logPromoActivity(organizationId: string, promoId: string, actorId: string | null, entries: (Partial<Omit<ActivityEntry, "kind">> & { kind: string; note?: string | null })[]) {
  if (!entries.length) return;
  try {
    const db = tenantDb(organizationId);
    for (const e of entries) {
      await db.calendarPromoActivity.create({
        data: { organizationId, promoId, actorId, kind: e.kind, field: e.field ?? null, fromValue: e.fromValue ?? null, toValue: e.toValue ?? null, note: e.note ?? null },
      });
    }
  } catch (error) {
    console.error("[calendar] could not log promo activity", error);
  }
}

/**
 * Create the promo's launch event once, or keep a live one's name and date in step.
 * Returns the created event id, if one was made.
 */
export async function syncLaunchEvent(input: { organizationId: string; brandId: string; promoId: string; actorId: string | null; defaultEventStage: string }): Promise<string | null> {
  const db = tenantDb(input.organizationId);
  const promo = await findPromo(input.organizationId, input.brandId, input.promoId);
  if (!promo) return null;
  const existing = promo.launchEventId ? await db.calendarEvent.findFirst({ where: { id: promo.launchEventId, brandId: input.brandId }, select: { id: true, deletedAt: true } }) : null;
  const plan = planLaunchEvent(promo, existing ? { live: !existing.deletedAt } : null);
  if (plan.action === "create") {
    const event = await db.calendarEvent.create({
      data: {
        organizationId: input.organizationId,
        brandId: input.brandId,
        name: plan.name,
        eventType: "Sales event",
        format: plan.format,
        stage: input.defaultEventStage,
        eventDate: fromDay(plan.eventDate),
        offer: plan.offer,
        hosts: plan.hosts,
        calendarPromoId: promo.id,
        createdById: input.actorId,
        updatedById: input.actorId,
      },
      select: { id: true },
    });
    // Claim the flag only if nobody else did, so two saves never make two launch events.
    const claimed = await db.calendarPromo.updateMany({ where: { id: promo.id, launchEventCreated: false }, data: { launchEventCreated: true, launchEventId: event.id } });
    if (!claimed.count) {
      await db.calendarEvent.deleteMany({ where: { id: event.id } });
      return null;
    }
    await logPromoActivity(input.organizationId, promo.id, input.actorId, [{ kind: "launchEvent", note: `Launch event added for ${plan.eventDate}` }]);
    return event.id;
  }
  if (plan.action === "update" && existing) {
    await db.calendarEvent.updateMany({ where: { id: existing.id, deletedAt: null }, data: { name: plan.name, eventDate: fromDay(plan.eventDate), updatedById: input.actorId } });
  }
  return null;
}

/** Write or refresh the Brain note for one promo. Soft-fails. */
export async function teachPromo(input: { organizationId: string; promoId: string; actorId: string | null }): Promise<void> {
  try {
    const row = await tenantDb(input.organizationId).calendarPromo.findFirst({ where: { id: input.promoId, deletedAt: null } });
    if (!row) return;
    const note = promoBrainNote({ ...row, launchDate: toDay(row.launchDate), targetedDate: toDay(row.targetedDate) });
    await teachBrain({
      organizationId: input.organizationId,
      brandId: row.brandId,
      sourceRef: `calendar-promo:${row.id}`,
      title: note.title,
      body: note.body,
      folder: "Marketing Calendar",
      source: "marketing-calendar",
      actorId: input.actorId,
    });
  } catch (error) {
    console.error("[calendar] could not teach the Brain about a promo", error);
  }
}
