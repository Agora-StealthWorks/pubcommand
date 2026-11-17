/**
 * Recurring events and the two edit scopes.
 *
 * "single"    touches one occurrence. It never changes the series (cadence,
 *             start, end or shared copy), so one edit can't reshape the schedule.
 * "following" touches the occurrence and every later one in the same series.
 *             Earlier occurrences are never rewritten.
 *
 * What a "following" edit copies forward is the shared copy only (name, type,
 * stage, channels, hosts, offer, links, notes). Never an occurrence's own dates
 * and never its metrics. If the anchor's event date moved, later occurrences
 * shift by the same number of days.
 */
import { addDays, addMonths, diffDays, isDay } from "./dates";
import type { EventDates } from "./stages";

export type SeriesScope = "single" | "following";
export const FREQUENCIES = ["weekly", "biweekly", "monthly", "quarterly"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  weekly: "Every week",
  biweekly: "Every two weeks",
  monthly: "Every month",
  quarterly: "Every quarter",
};

/** Anything but "following" (or the legacy "series") is a single-occurrence edit. */
export function normalizeScope(value: unknown): SeriesScope {
  return value === "following" || value === "series" ? "following" : "single";
}

export function isFrequency(value: unknown): value is Frequency {
  return typeof value === "string" && (FREQUENCIES as readonly string[]).includes(value);
}

/** The most occurrences one series ever generates in a pass. */
export const MAX_OCCURRENCES = 120;
/** Without an end date, a series is generated this far ahead of its start (or today). */
export const HORIZON_DAYS = 182;

/** Every occurrence day of a cadence from `startsOn` to `until` (inclusive). */
export function occurrenceDays(series: { frequency: Frequency; startsOn: string; until: string | null }, horizonEnd: string): string[] {
  const end = series.until && series.until < horizonEnd ? series.until : series.until ?? horizonEnd;
  const days: string[] = [];
  const dayOfMonth = Number(series.startsOn.slice(8, 10));
  for (let n = 0; days.length < MAX_OCCURRENCES; n += 1) {
    let day: string;
    if (series.frequency === "weekly") day = addDays(series.startsOn, 7 * n);
    else if (series.frequency === "biweekly") day = addDays(series.startsOn, 14 * n);
    else if (series.frequency === "monthly") day = addMonths(series.startsOn, n, dayOfMonth);
    else day = addMonths(series.startsOn, 3 * n, dayOfMonth);
    if (day > end) break;
    days.push(day);
  }
  return days;
}

/** The horizon a series without an end date is generated to. */
export function horizonFor(startsOn: string, today: string): string {
  return addDays(startsOn > today ? startsOn : today, HORIZON_DAYS);
}

/** The marketing window of an event, as day offsets around its event date. */
export type WindowOffsets = { preDays: number | null; eventDays: number; postDays: number | null };

export function windowOffsets(e: EventDates): WindowOffsets | null {
  if (!e.eventDate) return null;
  const last = e.eventEnd && e.eventEnd >= e.eventDate ? e.eventEnd : e.eventDate;
  return {
    preDays: e.marketingStart ? Math.max(0, diffDays(e.marketingStart, e.eventDate)) : null,
    eventDays: diffDays(e.eventDate, last),
    postDays: e.marketingEnd ? Math.max(0, diffDays(last, e.marketingEnd)) : null,
  };
}

/** An occurrence's dates for an event day, using the anchor's window. */
export function datesForOccurrence(day: string, offsets: WindowOffsets | null): EventDates {
  if (!offsets) return { marketingStart: null, eventDate: day, eventEnd: null, marketingEnd: null };
  const last = addDays(day, offsets.eventDays);
  return {
    marketingStart: offsets.preDays != null ? addDays(day, -offsets.preDays) : null,
    eventDate: day,
    eventEnd: offsets.eventDays > 0 ? last : null,
    marketingEnd: offsets.postDays != null ? addDays(last, offsets.postDays) : null,
  };
}

/**
 * The occurrences to create for a series, skipping days that already have one.
 * `from` excludes anything before it (a "following" regeneration starts after the anchor).
 */
export function planOccurrences(input: {
  frequency: Frequency;
  startsOn: string;
  until: string | null;
  today: string;
  existingDays: string[];
  offsets: WindowOffsets | null;
  after?: string;
}): EventDates[] {
  const existing = new Set(input.existingDays);
  const horizon = input.until ?? horizonFor(input.startsOn, input.today);
  return occurrenceDays({ frequency: input.frequency, startsOn: input.startsOn, until: input.until }, horizon)
    .filter((day) => !existing.has(day) && (!input.after || day > input.after))
    .map((day) => datesForOccurrence(day, input.offsets));
}

/** Fields that belong to one occurrence and never travel across a series. */
export const PER_OCCURRENCE_FIELDS = [
  "marketingStart",
  "eventDate",
  "eventEnd",
  "marketingEnd",
  "peakAttendance",
  "avgAttendance",
  "registrations",
  "newSubscribers",
  "leads",
  "orders",
  "revenue",
  "messages",
] as const;

const PER_OCCURRENCE = new Set<string>(PER_OCCURRENCE_FIELDS);

/** The part of an edit a "following" scope may copy to later occurrences. */
export function sharedFields<T extends Record<string, unknown>>(data: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!PER_OCCURRENCE.has(key)) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

/** Whole days the anchor's event date moved; 0 when either side is missing. */
export function dateShiftDays(before: string | null, after: string | null): number {
  return isDay(before) && isDay(after) ? diffDays(before, after) : 0;
}

/** One later occurrence's dates moved by `delta` days (unchanged when delta is 0). */
export function shiftDates(o: EventDates, delta: number): EventDates {
  if (!delta) return { ...o };
  const move = (day: string | null) => (day ? addDays(day, delta) : null);
  return {
    marketingStart: move(o.marketingStart),
    eventDate: move(o.eventDate),
    eventEnd: move(o.eventEnd),
    marketingEnd: move(o.marketingEnd),
  };
}

export type Occurrence = EventDates & { id: string; seriesId: string | null; deletedAt?: Date | string | null };

/**
 * Is `candidate` one of the "following" occurrences of `anchor`? Same series,
 * on or after the anchor's date (as it was BEFORE the edit), not the anchor, not trashed.
 * An anchor with no date reaches the whole series rather than nothing.
 */
export function isFollowing(anchor: Occurrence, candidate: Occurrence): boolean {
  if (!anchor.seriesId || candidate.seriesId !== anchor.seriesId) return false;
  if (candidate.id === anchor.id || candidate.deletedAt) return false;
  if (!anchor.eventDate) return true;
  return Boolean(candidate.eventDate && candidate.eventDate >= anchor.eventDate);
}

export type FollowingUpdate<T> = { id: string; shared: Partial<T>; dates: EventDates };

/**
 * The updates a "following" edit makes to later occurrences: the shared copy
 * of the edit, and each occurrence's own dates shifted by the anchor's move.
 */
export function planFollowingEdit<T extends Record<string, unknown>>(input: {
  anchorBefore: Occurrence;
  edited: T & { eventDate: string | null };
  candidates: Occurrence[];
}): FollowingUpdate<T>[] {
  const shared = sharedFields(input.edited);
  const delta = dateShiftDays(input.anchorBefore.eventDate, input.edited.eventDate);
  return input.candidates
    .filter((candidate) => isFollowing(input.anchorBefore, candidate))
    .map((candidate) => ({ id: candidate.id, shared, dates: shiftDates(candidate, delta) }));
}

/** Did the cadence of a series change (repeat or end date)? */
export function cadenceChanged(series: { frequency: string; until: string | null; active: boolean }, repeat: Frequency | null, until: string | null): boolean {
  if (!repeat) return series.active;
  return !series.active || series.frequency !== repeat || (series.until ?? null) !== (until ?? null);
}

/**
 * What a save does to the series, by scope. Pure decision; the server carries it out.
 *
 * - single: "none" always. One occurrence never reshapes the series.
 * - following + no series + repeat: "create" a series anchored here.
 * - following + series + repeat cleared: "stop" (trash later occurrences, end the series).
 * - following + series + new cadence: "reschedule" (trash later ones, regenerate from here).
 * - following + series + same cadence: "propagate" shared copy and date shift.
 */
export type SeriesAction = "none" | "create" | "stop" | "reschedule" | "propagate";

export function seriesAction(input: {
  scope: SeriesScope;
  series: { frequency: string; until: string | null; active: boolean } | null;
  repeat: Frequency | null;
  until: string | null;
}): SeriesAction {
  if (input.scope === "single") return "none";
  if (!input.series) return input.repeat ? "create" : "none";
  if (!input.repeat) return input.series.active ? "stop" : "none";
  return cadenceChanged(input.series, input.repeat, input.until) ? "reschedule" : "propagate";
}

/** How far ahead the extension job keeps an open-ended series planned. */
export const EXTEND_MONTHS = 6;

/**
 * Occurrence days of a cadence strictly after `after`, up to `horizonEnd` and
 * the series' own end. Unlike occurrenceDays it does not stop after
 * MAX_OCCURRENCES counted from the start, so a series that began years ago
 * still extends.
 */
export function daysAfter(series: { frequency: Frequency; startsOn: string; until: string | null }, after: string, horizonEnd: string, cap = MAX_OCCURRENCES): string[] {
  const end = series.until && series.until < horizonEnd ? series.until : horizonEnd;
  const dayOfMonth = Number(series.startsOn.slice(8, 10));
  const step = series.frequency === "weekly" ? 7 : series.frequency === "biweekly" ? 14 : 0;
  const days: string[] = [];
  if (step) {
    const gap = Math.max(0, diffDays(series.startsOn, after));
    for (let n = Math.floor(gap / step); days.length < cap; n += 1) {
      const day = addDays(series.startsOn, step * n);
      if (day > end) break;
      if (day > after) days.push(day);
    }
    return days;
  }
  const months = series.frequency === "monthly" ? 1 : 3;
  const monthsGap = Math.max(0, (Number(after.slice(0, 4)) - Number(series.startsOn.slice(0, 4))) * 12 + Number(after.slice(5, 7)) - Number(series.startsOn.slice(5, 7)));
  for (let n = Math.max(0, Math.floor(monthsGap / months) - 1); days.length < cap; n += 1) {
    const day = addMonths(series.startsOn, months * n, dayOfMonth);
    if (day > end) break;
    if (day > after) days.push(day);
  }
  return days;
}

/**
 * The occurrences the extension job adds to one series. Only open-ended,
 * active, untrashed series extend. New days come strictly after the latest
 * occurrence ever planned (trashed ones included), so an occurrence someone
 * deleted is never brought back. Dates follow the latest live occurrence's window.
 */
export function extensionPlan(input: {
  series: { frequency: string; startsOn: string; until: string | null; active: boolean; deletedAt: Date | string | null };
  /** Every occurrence of the series, trashed ones included. */
  occurrences: (EventDates & { deletedAt: Date | string | null })[];
  today: string;
  months?: number;
}): EventDates[] {
  const s = input.series;
  if (!s.active || s.deletedAt || s.until || !isFrequency(s.frequency)) return [];
  const horizon = addMonths(input.today, input.months ?? EXTEND_MONTHS);
  const planned = input.occurrences.map((o) => o.eventDate).filter((d): d is string => isDay(d)).sort();
  const latest = planned[planned.length - 1] ?? addDays(s.startsOn, -1);
  if (latest >= horizon) return [];
  const live = input.occurrences.filter((o) => !o.deletedAt && isDay(o.eventDate)).sort((a, b) => a.eventDate!.localeCompare(b.eventDate!));
  const template = live[live.length - 1] ?? null;
  const offsets = template ? windowOffsets(template) : null;
  return daysAfter({ frequency: s.frequency, startsOn: s.startsOn, until: null }, latest, horizon).map((day) => datesForOccurrence(day, offsets));
}
