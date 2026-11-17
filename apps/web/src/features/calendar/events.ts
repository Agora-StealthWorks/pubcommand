import { tenantDb, type Prisma } from "@pubcommand/db";
import { fromDay, todayIn, toDay } from "../../../../../modules/editorial/dates";
import {
  isFrequency,
  planFollowingEdit,
  planOccurrences,
  seriesAction,
  sharedFields,
  windowOffsets,
  type Frequency,
  type SeriesScope,
} from "../../../../../modules/editorial/recurrence";
import type { EventDates } from "../../../../../modules/editorial/stages";

/** The editable fields of an event, with dates as "YYYY-MM-DD". */
export type EventInput = EventDates & {
  name: string;
  eventType: string | null;
  format: string | null;
  stage: string;
  startTime: string | null;
  endTime: string | null;
  channels: string[];
  hosts: string[];
  offer: string | null;
  promoCode: string | null;
  ctaLink: string | null;
  registrationLink: string | null;
  replayLink: string | null;
  notes: string | null;
  peakAttendance: number | null;
  avgAttendance: number | null;
  registrations: number | null;
  newSubscribers: number | null;
  leads: number | null;
  orders: number | null;
  revenue: number | null;
  messages: number | null;
};

type EventRow = Awaited<ReturnType<ReturnType<typeof tenantDb>["calendarEvent"]["findFirst"]>> & {};

export function eventDates(row: { marketingStart: Date | null; eventDate: Date | null; eventEnd: Date | null; marketingEnd: Date | null }): EventDates {
  return { marketingStart: toDay(row.marketingStart), eventDate: toDay(row.eventDate), eventEnd: toDay(row.eventEnd), marketingEnd: toDay(row.marketingEnd) };
}

function datesData(d: EventDates) {
  return { marketingStart: fromDay(d.marketingStart), eventDate: fromDay(d.eventDate), eventEnd: fromDay(d.eventEnd), marketingEnd: fromDay(d.marketingEnd) };
}

function toData(input: Partial<EventInput>): Prisma.CalendarEventUncheckedUpdateManyInput {
  const { marketingStart, eventDate, eventEnd, marketingEnd, ...rest } = input;
  const data: Record<string, unknown> = { ...rest };
  if ("marketingStart" in input) data.marketingStart = fromDay(marketingStart);
  if ("eventDate" in input) data.eventDate = fromDay(eventDate);
  if ("eventEnd" in input) data.eventEnd = fromDay(eventEnd);
  if ("marketingEnd" in input) data.marketingEnd = fromDay(marketingEnd);
  return data as Prisma.CalendarEventUncheckedUpdateManyInput;
}

type SeriesProfile = Partial<Omit<EventInput, keyof EventDates>>;

/** Create the occurrences a series is missing, after `after` (exclusive). Returns their ids. */
async function generate(
  organizationId: string,
  brandId: string,
  series: { id: string; frequency: Frequency; startsOn: string; until: string | null; profile: SeriesProfile },
  anchorDates: EventDates,
  after: string,
  actorId: string | null,
): Promise<string[]> {
  const db = tenantDb(organizationId);
  const existing = await db.calendarEvent.findMany({ where: { seriesId: series.id, deletedAt: null }, select: { eventDate: true } });
  const plan = planOccurrences({
    frequency: series.frequency,
    startsOn: series.startsOn,
    until: series.until,
    today: todayIn(),
    existingDays: existing.map((e) => toDay(e.eventDate)).filter((d): d is string => Boolean(d)),
    offsets: windowOffsets(anchorDates),
    after,
  });
  const ids: string[] = [];
  for (const dates of plan) {
    const row = await db.calendarEvent.create({
      data: {
        organizationId,
        brandId,
        ...(series.profile as Record<string, never>),
        name: series.profile.name ?? "Recurring event",
        stage: series.profile.stage ?? "Recurring",
        ...datesData(dates),
        seriesId: series.id,
        createdById: actorId,
        updatedById: actorId,
      },
      select: { id: true },
    });
    ids.push(row.id);
  }
  return ids;
}

function profileOf(input: EventInput): SeriesProfile {
  return sharedFields(input) as SeriesProfile;
}

export async function createEvent(input: {
  organizationId: string;
  brandId: string;
  actorId: string | null;
  data: EventInput;
  repeat: Frequency | null;
  until: string | null;
}): Promise<{ id: string; generated: number }> {
  const db = tenantDb(input.organizationId);
  const event = await db.calendarEvent.create({
    data: {
      organizationId: input.organizationId,
      brandId: input.brandId,
      ...(toData(input.data) as Record<string, never>),
      name: input.data.name,
      createdById: input.actorId,
      updatedById: input.actorId,
    },
    select: { id: true },
  });
  if (!input.repeat || !input.data.eventDate) return { id: event.id, generated: 0 };
  const series = await db.calendarSeries.create({
    data: {
      organizationId: input.organizationId,
      brandId: input.brandId,
      name: input.data.name,
      frequency: input.repeat,
      startsOn: fromDay(input.data.eventDate)!,
      until: fromDay(input.until),
      profile: profileOf(input.data) as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  await db.calendarEvent.updateMany({ where: { id: event.id }, data: { seriesId: series.id } });
  const ids = await generate(
    input.organizationId,
    input.brandId,
    { id: series.id, frequency: input.repeat, startsOn: input.data.eventDate, until: input.until, profile: profileOf(input.data) },
    input.data,
    input.data.eventDate,
    input.actorId,
  );
  return { id: event.id, generated: ids.length };
}

/**
 * Save an edit under a scope. A "single" edit writes only this occurrence and
 * never touches its series. A "following" edit also updates later occurrences
 * (shared copy + date shift) or, when the cadence changed, regenerates them.
 * Returns the ids of every event written.
 */
export async function updateEvent(input: {
  organizationId: string;
  brandId: string;
  actorId: string | null;
  before: NonNullable<EventRow>;
  data: EventInput;
  scope: SeriesScope;
  repeat: Frequency | null;
  until: string | null;
}): Promise<{ touched: string[]; action: string }> {
  const db = tenantDb(input.organizationId);
  const before = input.before;
  const beforeDates = eventDates(before);
  const series = before.seriesId ? await db.calendarSeries.findFirst({ where: { id: before.seriesId } }) : null;
  // A one-off event has no series to protect, so its repeat choice always applies.
  const scope: SeriesScope = series ? input.scope : "following";
  const action = seriesAction({
    scope,
    series: series ? { frequency: series.frequency, until: toDay(series.until), active: series.active } : null,
    repeat: input.repeat,
    until: input.until,
  });

  // Read the following set BEFORE the update: membership is judged on the anchor as it was.
  const candidates =
    scope === "following" && series
      ? await db.calendarEvent.findMany({
          where: { seriesId: series.id, deletedAt: null, id: { not: before.id } },
          select: { id: true, seriesId: true, marketingStart: true, eventDate: true, eventEnd: true, marketingEnd: true },
        })
      : [];

  await db.calendarEvent.updateMany({ where: { id: before.id }, data: { ...toData(input.data), updatedById: input.actorId } });
  const touched = [before.id];
  const anchorDay = input.data.eventDate ?? beforeDates.eventDate;

  if (action === "propagate" && series) {
    const updates = planFollowingEdit({
      anchorBefore: { id: before.id, seriesId: before.seriesId, ...beforeDates },
      edited: input.data,
      candidates: candidates.map((c) => ({ ...c, ...eventDates(c) })),
    });
    for (const update of updates) {
      await db.calendarEvent.updateMany({
        where: { id: update.id },
        data: { ...toData(update.shared as Partial<EventInput>), ...datesData(update.dates), updatedById: input.actorId },
      });
      touched.push(update.id);
    }
    await db.calendarSeries.updateMany({ where: { id: series.id }, data: { name: input.data.name, profile: profileOf(input.data) as Prisma.InputJsonValue } });
  }

  if ((action === "reschedule" || action === "stop") && series && anchorDay) {
    // Later occurrences on the old rhythm go to the trash; the anchor and the past survive.
    await db.calendarEvent.updateMany({
      where: { seriesId: series.id, deletedAt: null, id: { not: before.id }, eventDate: { gt: fromDay(beforeDates.eventDate ?? anchorDay)! } },
      data: { deletedAt: new Date() },
    });
  }

  if (action === "stop" && series) {
    await db.calendarSeries.updateMany({ where: { id: series.id }, data: { active: false, until: fromDay(anchorDay) } });
  }

  if (action === "reschedule" && series && input.repeat && anchorDay) {
    await db.calendarSeries.updateMany({
      where: { id: series.id },
      data: { name: input.data.name, frequency: input.repeat, startsOn: fromDay(anchorDay)!, until: fromDay(input.until), active: true, profile: profileOf(input.data) as Prisma.InputJsonValue },
    });
    touched.push(
      ...(await generate(
        input.organizationId,
        input.brandId,
        { id: series.id, frequency: input.repeat, startsOn: anchorDay, until: input.until, profile: profileOf(input.data) },
        input.data,
        anchorDay,
        input.actorId,
      )),
    );
  }

  if (action === "create" && input.repeat && anchorDay) {
    const created = await db.calendarSeries.create({
      data: {
        organizationId: input.organizationId,
        brandId: input.brandId,
        name: input.data.name,
        frequency: input.repeat,
        startsOn: fromDay(anchorDay)!,
        until: fromDay(input.until),
        profile: profileOf(input.data) as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    await db.calendarEvent.updateMany({ where: { id: before.id }, data: { seriesId: created.id } });
    touched.push(
      ...(await generate(
        input.organizationId,
        input.brandId,
        { id: created.id, frequency: input.repeat, startsOn: anchorDay, until: input.until, profile: profileOf(input.data) },
        input.data,
        anchorDay,
        input.actorId,
      )),
    );
  }
  return { touched, action };
}

/** Soft-delete one occurrence, or it and every later one ("following"). */
export async function deleteEvent(input: { organizationId: string; event: NonNullable<EventRow>; scope: SeriesScope }): Promise<number> {
  const db = tenantDb(input.organizationId);
  const now = new Date();
  if (input.scope === "following" && input.event.seriesId) {
    const day = input.event.eventDate;
    const result = await db.calendarEvent.updateMany({
      where: { seriesId: input.event.seriesId, deletedAt: null, OR: [{ id: input.event.id }, ...(day ? [{ eventDate: { gte: day } }] : [{}])] },
      data: { deletedAt: now },
    });
    await db.calendarSeries.updateMany({
      where: { id: input.event.seriesId },
      data: day ? { until: new Date(day.getTime() - 86_400_000) } : { active: false },
    });
    return result.count;
  }
  const result = await db.calendarEvent.updateMany({ where: { id: input.event.id }, data: { deletedAt: now } });
  return result.count;
}

export function parseRepeat(value: string): Frequency | null {
  return isFrequency(value) ? value : null;
}
