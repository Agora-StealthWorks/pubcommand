import { tenantDb } from "@pubcommand/db";
import { toDay } from "../../../../../modules/editorial/dates";
import { eventRestoreBlocker, seriesRestoreSet, type TrashKind } from "../../../../../modules/editorial/trash";

export type TrashRow = { kind: TrashKind; id: string; title: string; detail: string; deletedAt: Date; blocker: string | null; count?: number };

/** Everything in the brand's trash, newest first. Occurrences of a trashed series are listed under the series. */
export async function listTrash(organizationId: string, brandId: string): Promise<TrashRow[]> {
  const db = tenantDb(organizationId);
  const [series, events, issues] = await Promise.all([
    db.calendarSeries.findMany({ where: { brandId, deletedAt: { not: null } }, orderBy: { deletedAt: "desc" }, take: 200 }),
    db.calendarEvent.findMany({
      where: { brandId, deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      take: 500,
      select: { id: true, name: true, eventDate: true, seriesId: true, deletedAt: true },
    }),
    db.calendarIssue.findMany({
      where: { brandId, deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      take: 500,
      select: { id: true, title: true, publicationCode: true, mailDate: true, deletedAt: true },
    }),
  ]);
  const trashedSeries = new Map(series.map((s) => [s.id, s]));
  const rows: TrashRow[] = [];
  for (const s of series) {
    const members = events.filter((e) => e.seriesId === s.id);
    rows.push({ kind: "series", id: s.id, title: s.name, detail: `Recurring series · ${seriesRestoreSet(s.deletedAt!, members).length} occurrences`, deletedAt: s.deletedAt!, blocker: null });
  }
  for (const e of events) {
    const s = e.seriesId ? trashedSeries.get(e.seriesId) : null;
    if (s && seriesRestoreSet(s.deletedAt!, [e]).length) continue; // shown as part of its series
    rows.push({ kind: "event", id: e.id, title: e.name, detail: `Event · ${toDay(e.eventDate) ?? "no date"}`, deletedAt: e.deletedAt!, blocker: eventRestoreBlocker(e, s ?? null) });
  }
  for (const i of issues) rows.push({ kind: "issue", id: i.id, title: i.title, detail: `Issue · ${i.publicationCode} · ${toDay(i.mailDate) ?? "no date"}`, deletedAt: i.deletedAt!, blocker: null });
  return rows.sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());
}

/** Move a series and every live occurrence to the trash, stamped with one instant. */
export async function trashSeries(organizationId: string, brandId: string, seriesId: string): Promise<number> {
  const db = tenantDb(organizationId);
  const now = new Date();
  const series = await db.calendarSeries.updateMany({ where: { id: seriesId, brandId, deletedAt: null }, data: { deletedAt: now, active: false } });
  if (!series.count) return 0;
  const events = await db.calendarEvent.updateMany({ where: { seriesId, deletedAt: null }, data: { deletedAt: now } });
  return events.count;
}

/** Restore one trashed row. Returns the ids of events/issues restored (for re-teaching), or an error message. */
export async function restoreFromTrash(organizationId: string, brandId: string, kind: TrashKind, id: string): Promise<{ events: string[]; issues: string[] } | { error: string }> {
  const db = tenantDb(organizationId);
  if (kind === "issue") {
    const r = await db.calendarIssue.updateMany({ where: { id, brandId, deletedAt: { not: null } }, data: { deletedAt: null } });
    return r.count ? { events: [], issues: [id] } : { error: "That issue is not in the trash." };
  }
  if (kind === "event") {
    const event = await db.calendarEvent.findFirst({ where: { id, brandId, deletedAt: { not: null } }, select: { id: true, seriesId: true } });
    if (!event) return { error: "That event is not in the trash." };
    const series = event.seriesId ? await db.calendarSeries.findFirst({ where: { id: event.seriesId }, select: { deletedAt: true } }) : null;
    const blocker = eventRestoreBlocker(event, series);
    if (blocker) return { error: blocker };
    await db.calendarEvent.updateMany({ where: { id }, data: { deletedAt: null } });
    return { events: [id], issues: [] };
  }
  const series = await db.calendarSeries.findFirst({ where: { id, brandId, deletedAt: { not: null } } });
  if (!series) return { error: "That series is not in the trash." };
  const members = await db.calendarEvent.findMany({ where: { seriesId: id, deletedAt: { not: null } }, select: { id: true, deletedAt: true } });
  const ids = seriesRestoreSet(series.deletedAt!, members);
  await db.calendarSeries.updateMany({ where: { id }, data: { deletedAt: null, active: true } });
  if (ids.length) await db.calendarEvent.updateMany({ where: { id: { in: ids } }, data: { deletedAt: null } });
  return { events: ids, issues: [] };
}

/**
 * Delete one trashed row for good. Rows that came from Airtable leave a
 * tombstone in the sync log so the next pull does not bring them back.
 */
export async function purgeFromTrash(organizationId: string, brandId: string, kind: TrashKind, id: string): Promise<number> {
  const db = tenantDb(organizationId);
  const tombstone = async (entity: "event" | "issue", rows: { id: string; airtableId: string | null }[]) => {
    for (const row of rows.filter((r) => r.airtableId)) {
      await db.calendarSyncLog.create({ data: { organizationId, brandId, direction: "delete", entity, airtableId: row.airtableId, status: "tombstone", message: "Deleted for good in the calendar." } });
    }
  };
  if (kind === "issue") {
    const rows = await db.calendarIssue.findMany({ where: { id, brandId, deletedAt: { not: null } }, select: { id: true, airtableId: true } });
    await tombstone("issue", rows);
    return (await db.calendarIssue.deleteMany({ where: { id, brandId, deletedAt: { not: null } } })).count;
  }
  if (kind === "event") {
    const rows = await db.calendarEvent.findMany({ where: { id, brandId, deletedAt: { not: null } }, select: { id: true, airtableId: true } });
    await tombstone("event", rows);
    return (await db.calendarEvent.deleteMany({ where: { id, brandId, deletedAt: { not: null } } })).count;
  }
  const series = await db.calendarSeries.findFirst({ where: { id, brandId, deletedAt: { not: null } } });
  if (!series) return 0;
  const members = await db.calendarEvent.findMany({ where: { seriesId: id, deletedAt: { not: null } }, select: { id: true, deletedAt: true, airtableId: true } });
  const ids = seriesRestoreSet(series.deletedAt!, members);
  await tombstone("event", members.filter((m) => ids.includes(m.id)));
  const removed = ids.length ? (await db.calendarEvent.deleteMany({ where: { id: { in: ids } } })).count : 0;
  await db.calendarSeries.deleteMany({ where: { id } });
  return removed + 1;
}
