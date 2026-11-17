/**
 * Add to calendar: an .ics invite (Apple Calendar, Outlook) and a Google
 * Calendar link for a live session or the home page event box. PURE.
 *
 * Times are written as UTC instants (unambiguous in every calendar app), and the
 * calendar carries the organization's time zone (X-WR-TIMEZONE, Google `ctz`)
 * so apps show the wall clock the emails use. Descriptions format the date in
 * that zone.
 */
import { DEFAULT_LIVE_HOURS, liveWindow } from "./state";
import { formatZoned, safeZone } from "./time";

export type CalendarEvent = {
  /** Stable per event so re-adding updates instead of duplicating. */
  uid: string;
  title: string;
  description: string;
  start: Date;
  end: Date;
  location: string;
  url: string;
  /** Minutes before the start (.ics only; Google links carry no reminders). */
  reminders?: number[];
};

/** 20261103T200000Z */
export function icsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** RFC 5545 TEXT escaping. */
export function icsEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1");
}

const encoder = new TextEncoder();
const bytes = (value: string) => encoder.encode(value).length;

/** Fold a content line at 75 octets (continuation lines start with a space). Never splits a character. */
export function foldLine(line: string): string {
  if (bytes(line) <= 75) return line;
  const out: string[] = [];
  const limit = 75;
  let rest = line;
  while (bytes(rest) > limit) {
    let cut = Math.min(rest.length, limit);
    while (cut > 1 && bytes(rest.slice(0, cut)) > limit) cut -= 1;
    // Do not cut a surrogate pair in half.
    if (/[\uD800-\uDBFF]/.test(rest.charAt(cut - 1))) cut -= 1;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join("\r\n");
}

function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function vevent(event: CalendarEvent, stamp: Date, domain: string): string[] {
  const uid = oneLine(event.uid).replace(/[^A-Za-z0-9._@-]/g, "-").slice(0, 120);
  const alarms = (event.reminders ?? [])
    .filter((minutes) => Number.isInteger(minutes) && minutes >= 0 && minutes <= 40320)
    .slice(0, 5)
    .flatMap((minutes) => ["BEGIN:VALARM", `TRIGGER:-PT${minutes}M`, "ACTION:DISPLAY", `DESCRIPTION:${icsEscape(oneLine(event.title))}`, "END:VALARM"]);
  const url = /^https?:\/\/[^\s]+$/i.test(event.url) ? event.url : "";
  return [
    "BEGIN:VEVENT",
    `UID:${uid}@${domain}`,
    `DTSTAMP:${icsDate(stamp)}`,
    `DTSTART:${icsDate(event.start)}`,
    `DTEND:${icsDate(event.end > event.start ? event.end : new Date(event.start.getTime() + 3_600_000))}`,
    `SUMMARY:${icsEscape(oneLine(event.title))}`,
    `DESCRIPTION:${icsEscape(event.description)}`,
    ...(event.location ? [`LOCATION:${icsEscape(oneLine(event.location))}`] : []),
    ...(url ? [`URL:${url}`] : []),
    ...alarms,
    "END:VEVENT",
  ];
}

/** One .ics file holding one or more events. CRLF line endings, folded lines. */
export function icsFile(events: readonly CalendarEvent[], options: { timeZone: string; calendarName?: string; stamp?: Date; domain?: string }): string {
  const stamp = options.stamp ?? new Date();
  const domain = (options.domain ?? "pubcommand").replace(/[^A-Za-z0-9.-]/g, "");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PubCommand//Funnels//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-TIMEZONE:${safeZone(options.timeZone)}`,
    ...(options.calendarName ? [`X-WR-CALNAME:${icsEscape(oneLine(options.calendarName))}`] : []),
    ...events.flatMap((event) => vevent(event, stamp, domain || "pubcommand")),
    "END:VCALENDAR",
    "",
  ]
    .map(foldLine)
    .join("\r\n");
}

/** A Google Calendar "add event" link, shown in the org time zone. */
export function googleCalendarUrl(event: CalendarEvent, timeZone: string): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: oneLine(event.title),
    dates: `${icsDate(event.start)}/${icsDate(event.end > event.start ? event.end : new Date(event.start.getTime() + 3_600_000))}`,
    details: event.description,
    location: event.location,
    ctz: safeZone(timeZone),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** The invite for a live session. Null when the day has no start time. */
export function liveSessionEvent(input: {
  funnelId: string;
  funnelName: string;
  day: { id: string; label: string; title: string; topics: string[]; liveStartAt: Date | null; liveEndAt: Date | null; liveUrl: string | null };
  roomUrl: string | null;
  pageUrl: string;
  timeZone: string;
}): CalendarEvent | null {
  const { start, end } = liveWindow(input.day);
  if (!start || !end) return null;
  const room = input.day.liveUrl || input.roomUrl || input.pageUrl;
  const title = `${input.funnelName}: ${input.day.title || input.day.label}`;
  const topics = input.day.topics.filter(Boolean).map((topic) => `• ${topic}`);
  return {
    uid: `funnel-${input.funnelId}-day-${input.day.id}`,
    title,
    description: [`${input.day.title || input.day.label} goes live ${formatZoned(start, input.timeZone)}.`, ...(topics.length ? ["", ...topics] : []), "", `Join here: ${room}`].join("\n"),
    start,
    end,
    location: room,
    url: room,
    reminders: [1440, 60, 15],
  };
}

/** The invite for a home page event box. Null without a start. */
export function eventBoxEvent(input: { funnelId: string; blockId: string; title: string; start: Date | null; minutes: number; pageUrl: string; timeZone: string }): CalendarEvent | null {
  if (!input.start || Number.isNaN(input.start.getTime())) return null;
  const minutes = Math.max(5, Math.min(24 * 60, Math.round(input.minutes || DEFAULT_LIVE_HOURS * 60)));
  return {
    uid: `funnel-${input.funnelId}-event-${input.blockId}`,
    title: input.title,
    description: `${input.title} starts ${formatZoned(input.start, input.timeZone)}.\n\nDetails: ${input.pageUrl}`,
    start: input.start,
    end: new Date(input.start.getTime() + minutes * 60_000),
    location: input.pageUrl,
    url: input.pageUrl,
    reminders: [1440, 60],
  };
}
