import { tenantDb } from "@pubcommand/db";
import { eventBrainNote, issueBrainNote } from "../../../../../modules/editorial/brain";
import { toDay } from "../../../../../modules/editorial/dates";
import { teachBrain } from "../brain/teach";
import { eventDates } from "./events";

const FOLDER = "Marketing Calendar";

/** Write or refresh the Brain note for one issue. Soft-fails. */
export async function teachIssue(input: { organizationId: string; brandId: string; issueId: string; actorId: string | null }): Promise<void> {
  try {
    const db = tenantDb(input.organizationId);
    const issue = await db.calendarIssue.findFirst({ where: { id: input.issueId, deletedAt: null }, include: { stat: true } });
    if (!issue) return;
    const pub = await db.calendarPublication.findFirst({ where: { brandId: issue.brandId, code: issue.publicationCode }, select: { name: true } });
    const note = issueBrainNote({
      title: issue.title,
      publicationCode: issue.publicationCode,
      publicationName: pub?.name ?? null,
      mailDate: toDay(issue.mailDate),
      status: issue.status,
      issueType: issue.issueType,
      writer: issue.writer,
      subjectLines: issue.subjectLines,
      offer: issue.offer,
      notes: issue.notes,
      stats: issue.stat ? { delivered: issue.stat.delivered, openRate: issue.stat.openRate, clickRate: issue.stat.clickRate, revenue: issue.stat.revenue } : null,
    });
    await teachBrain({
      organizationId: input.organizationId,
      brandId: issue.brandId,
      sourceRef: `calendar-issue:${issue.id}`,
      title: note.title,
      body: note.body,
      folder: FOLDER,
      source: "marketing-calendar",
      actorId: input.actorId,
    });
    // Not an edit: keep updatedAt so the catch-up job and Airtable push read it correctly.
    await db.calendarIssue.updateMany({ where: { id: issue.id, updatedAt: issue.updatedAt }, data: { brainTaughtAt: new Date(), updatedAt: issue.updatedAt } });
  } catch (error) {
    console.error("[calendar] could not teach the Brain about an issue", error);
  }
}

/** Write or refresh the Brain note for one event. Soft-fails. */
export async function teachEvent(input: { organizationId: string; brandId: string; eventId: string; actorId: string | null }): Promise<void> {
  try {
    const db = tenantDb(input.organizationId);
    const event = await db.calendarEvent.findFirst({ where: { id: input.eventId, deletedAt: null } });
    if (!event) return;
    const note = eventBrainNote({
      ...eventDates(event),
      name: event.name,
      stage: event.stage,
      eventType: event.eventType,
      format: event.format,
      startTime: event.startTime,
      channels: event.channels,
      hosts: event.hosts,
      offer: event.offer,
      notes: event.notes,
      recurring: Boolean(event.seriesId),
      metrics: { peakAttendance: event.peakAttendance, registrations: event.registrations, orders: event.orders, revenue: event.revenue },
    });
    await teachBrain({
      organizationId: input.organizationId,
      brandId: event.brandId,
      sourceRef: `calendar-event:${event.id}`,
      title: note.title,
      body: note.body,
      folder: FOLDER,
      source: "marketing-calendar",
      actorId: input.actorId,
    });
    await db.calendarEvent.updateMany({ where: { id: event.id, updatedAt: event.updatedAt }, data: { brainTaughtAt: new Date(), updatedAt: event.updatedAt } });
  } catch (error) {
    console.error("[calendar] could not teach the Brain about an event", error);
  }
}

/**
 * Teach every event and issue saved since it was last taught: anything written
 * outside the calendar's own forms (Mini-Blog posts, jobs, Airtable pulls) still
 * reaches the Brain. Idempotent: a taught row is skipped until it changes again.
 */
export async function teachPending(organizationId: string, limit = 100): Promise<{ issues: number; events: number }> {
  const db = tenantDb(organizationId);
  const stale = <T extends { updatedAt: Date; brainTaughtAt: Date | null }>(rows: T[]) => rows.filter((r) => !r.brainTaughtAt || r.updatedAt.getTime() > r.brainTaughtAt.getTime());
  const [issues, events] = await Promise.all([
    db.calendarIssue.findMany({ where: { deletedAt: null }, select: { id: true, brandId: true, updatedAt: true, brainTaughtAt: true }, orderBy: { updatedAt: "desc" }, take: 2000 }),
    db.calendarEvent.findMany({ where: { deletedAt: null }, select: { id: true, brandId: true, updatedAt: true, brainTaughtAt: true }, orderBy: { updatedAt: "desc" }, take: 2000 }),
  ]);
  const dueIssues = stale(issues).slice(0, limit);
  const dueEvents = stale(events).slice(0, limit);
  for (const row of dueIssues) await teachIssue({ organizationId, brandId: row.brandId, issueId: row.id, actorId: null });
  for (const row of dueEvents) await teachEvent({ organizationId, brandId: row.brandId, eventId: row.id, actorId: null });
  return { issues: dueIssues.length, events: dueEvents.length };
}
