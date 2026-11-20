/**
 * The "This week" strip on the list view: Monday to Friday of a week, with every event
 * happening on each day (event date through its end date). Days are "YYYY-MM-DD" in the
 * team's calendar terms (today comes from todayIn(), US Eastern), never UTC timestamps.
 */
import { addDays, fmtDay, weekday } from "./dates";

export const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;

/** Monday of the week containing `day` (a Saturday or Sunday belongs to the week before it). */
export function mondayOf(day: string): string {
  return addDays(day, -((weekday(day) + 6) % 7));
}

/** Clamp a ?week= offset to a sane whole number of weeks. */
export function weekOffset(raw: string | null | undefined): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) ? Math.max(-104, Math.min(104, n)) : 0;
}

export function weekTitle(offset: number): string {
  if (offset === 0) return "This week";
  if (offset === 1) return "Next week";
  if (offset === -1) return "Last week";
  return "Week of";
}

export type WeekEvent = { id: string; name: string; eventDate: string | null; eventEnd: string | null };

export type WeekDay<T> = { name: string; date: string; label: string; isToday: boolean; events: T[] };

/** The five weekdays of the week `offset` weeks from today's, each with its events sorted by name. */
export function weekStrip<T extends WeekEvent>(events: T[], today: string, offset: number): { days: WeekDay<T>[]; range: string; total: number; title: string } {
  const monday = addDays(mondayOf(today), offset * 7);
  const days = WEEKDAY_NAMES.map((name, i) => {
    const date = addDays(monday, i);
    const onDay = events
      .filter((e) => {
        if (!e.eventDate) return false;
        const end = e.eventEnd && e.eventEnd >= e.eventDate ? e.eventEnd : e.eventDate;
        return date >= e.eventDate && date <= end;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return { name, date, label: fmtDay(date), isToday: date === today, events: onDay };
  });
  const total = new Set(days.flatMap((d) => d.events.map((e) => e.id))).size;
  return { days, range: `${days[0]!.label} – ${days[4]!.label}`, total, title: weekTitle(offset) };
}

/** Left-border color for an event card, by event type. Known types get fixed colors. */
const TYPE_COLORS: Record<string, string> = {
  "sales event": "#12b76a",
  "editorial event": "#2563eb",
  "member event": "#7f56d9",
  "partner event": "#f79009",
};
const FALLBACK = ["#0e9384", "#dd2590", "#4e5ba6", "#ca8504", "#e04f16", "#6172f3"];

export function eventTypeColor(type: string | null | undefined): string {
  const key = (type ?? "").trim().toLowerCase();
  if (!key) return "#98a2b3";
  if (TYPE_COLORS[key]) return TYPE_COLORS[key]!;
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK[h % FALLBACK.length]!;
}
