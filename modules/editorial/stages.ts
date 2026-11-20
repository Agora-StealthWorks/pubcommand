/**
 * The three marketing stages of an event and how calendar items are placed.
 *
 *   pre   = marketingStart … the day before eventDate
 *   event = eventDate … eventEnd (eventEnd defaults to eventDate)
 *   post  = the day after eventEnd … marketingEnd
 */
import { addDays, diffDays, isDay } from "./dates";

export type StageKey = "pre" | "event" | "post";
export type BarKey = StageKey | "issue";

export const STAGE_COLORS: Record<BarKey, string> = {
  pre: "#2563eb",
  event: "#12b76a",
  post: "#475467",
  issue: "#7f77dd",
};

export const STAGE_LABELS: Record<StageKey, string> = {
  pre: "Pre-event marketing",
  event: "Event",
  post: "Post-event",
};

export const EVENT_STAGES = ["Idea", "Planned", "Scheduled", "Announced", "Paused", "Complete", "Recurring"] as const;
export const EVENT_TYPES = ["Sales event", "Editorial event", "Member event", "Partner event"] as const;
export const EVENT_FORMATS = ["Webinar", "Livestream", "Open house", "Demo", "Watch party", "Video drop", "Podcast", "In person", "Other"] as const;
export const ISSUE_STATUSES = ["Idea", "Planned", "Drafting", "Editing", "Scheduled", "Sent"] as const;
export const ISSUE_TYPES = ["Regular", "Bonus", "Special report", "Update", "Advertorial", "Publisher's note"] as const;

export type EventDates = {
  marketingStart: string | null;
  eventDate: string | null;
  eventEnd: string | null;
  marketingEnd: string | null;
};

/** The last day of the event itself. */
export function eventLastDay(e: EventDates): string | null {
  if (!e.eventDate) return null;
  return e.eventEnd && e.eventEnd >= e.eventDate ? e.eventEnd : e.eventDate;
}

/** Which stage an event is in on a day, or null when the day is outside its window. */
export function stageOn(e: EventDates, day: string): StageKey | null {
  const last = eventLastDay(e);
  if (e.eventDate && last && day >= e.eventDate && day <= last) return "event";
  if (e.eventDate && e.marketingStart && day >= e.marketingStart && day < e.eventDate) return "pre";
  if (last && e.marketingEnd && day > last && day <= e.marketingEnd) return "post";
  return null;
}

/** Contiguous stage runs, inclusive, ordered by date. Bad or reversed ranges are dropped. */
export function stageSpans(e: EventDates): { stage: StageKey; start: string; end: string }[] {
  const spans: { stage: StageKey; start: string; end: string }[] = [];
  const last = eventLastDay(e);
  if (!e.eventDate || !last) return spans;
  if (isDay(e.marketingStart) && e.marketingStart < e.eventDate) {
    spans.push({ stage: "pre", start: e.marketingStart, end: addDays(e.eventDate, -1) });
  }
  spans.push({ stage: "event", start: e.eventDate, end: last });
  if (isDay(e.marketingEnd) && e.marketingEnd > last) {
    spans.push({ stage: "post", start: addDays(last, 1), end: e.marketingEnd });
  }
  return spans;
}

/** Errors that block saving an event's dates. */
export function validateEventDates(e: EventDates): string[] {
  const errors: string[] = [];
  if (e.eventEnd && !e.eventDate) errors.push("Add the event date before an end date.");
  if (e.eventDate && e.eventEnd && e.eventEnd < e.eventDate) errors.push("The event end is before the event date.");
  if (e.marketingStart && e.eventDate && e.marketingStart > e.eventDate) errors.push("Marketing starts after the event.");
  const last = eventLastDay(e);
  if (e.marketingEnd && last && e.marketingEnd < last) errors.push("Marketing ends before the event does.");
  return errors;
}

export type FeedItem = {
  kind: "event" | "issue";
  id: string;
  title: string;
  /** Where the item sits on a list or a calendar day. */
  date: string | null;
  /** The last day the item is still "active". */
  until: string | null;
  stage: string | null;
  type: string | null;
  channels: string[];
  publicationCode: string | null;
  recurring: boolean;
  search: string;
};

export function eventFeedItem(e: EventDates & {
  id: string;
  name: string;
  stage: string;
  eventType: string | null;
  format: string | null;
  channels: string[];
  hosts: string[];
  offer: string | null;
  seriesId: string | null;
}): FeedItem {
  return {
    kind: "event",
    id: e.id,
    title: e.name,
    date: e.eventDate ?? e.marketingStart,
    until: e.marketingEnd ?? eventLastDay(e) ?? e.marketingStart,
    stage: e.stage,
    type: e.eventType,
    channels: e.channels,
    publicationCode: null,
    recurring: Boolean(e.seriesId) || e.stage === "Recurring",
    search: [e.name, e.eventType, e.format, e.offer, ...e.hosts, ...e.channels].filter(Boolean).join(" ").toLowerCase(),
  };
}

export function issueFeedItem(i: {
  id: string;
  title: string;
  mailDate: string | null;
  status: string;
  issueType: string | null;
  publicationCode: string;
  subjectLines: string[];
  writer: string | null;
}): FeedItem {
  return {
    kind: "issue",
    id: i.id,
    title: i.title,
    date: i.mailDate,
    until: i.mailDate,
    stage: i.status,
    type: i.issueType,
    channels: [],
    publicationCode: i.publicationCode,
    recurring: false,
    search: [i.title, i.publicationCode, i.issueType, i.writer, ...i.subjectLines].filter(Boolean).join(" ").toLowerCase(),
  };
}

export type FeedFilter = {
  q?: string;
  kind?: "all" | "event" | "issue";
  channel?: string;
  publication?: string;
  stage?: string;
  /** Event type (issues never match a type filter). */
  type?: string;
  /** Hide anything that finished before `today`. */
  upcoming?: boolean;
  hideRecurring?: boolean;
  from?: string;
  to?: string;
  today: string;
};

/**
 * Filter and sort the running list. Upcoming mode keeps anything still running
 * (an event stays active until its marketing ends) and sorts soonest first;
 * browsing all sorts newest first.
 */
export function filterFeed(items: FeedItem[], f: FeedFilter): FeedItem[] {
  const q = f.q?.trim().toLowerCase() ?? "";
  const out = items.filter((it) => {
    if (f.kind && f.kind !== "all" && it.kind !== f.kind) return false;
    if (f.channel && (it.kind !== "event" || !it.channels.includes(f.channel))) return false;
    if (f.publication && it.publicationCode !== f.publication) return false;
    if (f.stage && it.stage !== f.stage) return false;
    if (f.type && (it.kind !== "event" || it.type !== f.type)) return false;
    if (f.hideRecurring && it.recurring) return false;
    if (q && !it.search.includes(q)) return false;
    if (f.upcoming) {
      if (it.until && it.until < f.today) return false;
    } else {
      if (f.from && (!it.date || it.date < f.from)) return false;
      if (f.to && (!it.date || it.date > f.to)) return false;
    }
    return true;
  });
  return out.sort((a, b) => {
    const da = a.date ?? "9999-12-31";
    const db = b.date ?? "9999-12-31";
    const order = f.upcoming ? da.localeCompare(db) : db.localeCompare(da);
    return order || a.title.localeCompare(b.title);
  });
}

/** A bar segment on a week row of the month grid (column indexes 0–6). */
export type WeekSegment = { start: number; end: number; bar: BarKey; continuesLeft: boolean; continuesRight: boolean };

/** Clip an event's stage spans to one week starting on `weekStart`. */
export function weekSegments(e: EventDates, weekStart: string): WeekSegment[] {
  const weekEnd = addDays(weekStart, 6);
  const out: WeekSegment[] = [];
  for (const span of stageSpans(e)) {
    if (span.end < weekStart || span.start > weekEnd) continue;
    const start = Math.max(0, diffDays(weekStart, span.start));
    const end = Math.min(6, diffDays(weekStart, span.end));
    out.push({ start, end, bar: span.stage, continuesLeft: span.start < weekStart, continuesRight: span.end > weekEnd });
  }
  return out;
}

/** Percent offsets for a timeline bar between `rangeStart` and `rangeEnd` (inclusive days). */
export function timelineBar(start: string, end: string, rangeStart: string, rangeEnd: string): { left: number; width: number } | null {
  if (end < rangeStart || start > rangeEnd) return null;
  const total = diffDays(rangeStart, rangeEnd) + 1;
  const s = Math.max(0, diffDays(rangeStart, start));
  const e = Math.min(total - 1, diffDays(rangeStart, end));
  return { left: (s / total) * 100, width: ((e - s + 1) / total) * 100 };
}

/** Readable text color (#fff or near-black) on a solid hex background. */
export function contrastInk(hex: string | null | undefined): string {
  const h = (hex ?? "").replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) return "#ffffff";
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? "#101828" : "#ffffff";
}

export function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}
