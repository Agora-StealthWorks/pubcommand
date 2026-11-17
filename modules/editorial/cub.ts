/**
 * CUB Collector: a peer-review round on a promo draft. Reviewers upload a
 * marked-up copy and give four 0–10 scores. Scores are anonymous: only
 * averages are ever shown, never next to a name.
 */
import { addDays, weekday } from "./dates";

export const CUB_SCORES = [
  { key: "scoreHeadline", label: "Headline & lead", hint: "Does the opening grab the reader and promise something worth reading?" },
  { key: "scoreStory", label: "Story & flow", hint: "Does it hold attention and build belief from start to finish?" },
  { key: "scoreOffer", label: "Offer & close", hint: "Is the offer clear and the call to action compelling?" },
  { key: "scoreOverall", label: "Overall readiness", hint: "How close is this to ready to mail?" },
] as const;

export type CubScoreKey = (typeof CUB_SCORES)[number]["key"];
export type CubScores = Record<CubScoreKey, number>;
export type CubAverages = { count: number } & Record<CubScoreKey, number | null> & { overall: number | null };

/** A 0–10 whole-number score, or null when the input is not one. */
export function parseScore(value: unknown): number | null {
  const text = String(value ?? "").trim();
  if (!/^\d{1,2}$/.test(text)) return null;
  const n = Number(text);
  return n >= 0 && n <= 10 ? n : null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Each category averaged to one decimal, plus the mean of all four. */
export function averageScores(rows: CubScores[]): CubAverages {
  const count = rows.length;
  const avg = (key: CubScoreKey) => (count ? round1(rows.reduce((a, r) => a + r[key], 0) / count) : null);
  const out = { count, scoreHeadline: avg("scoreHeadline"), scoreStory: avg("scoreStory"), scoreOffer: avg("scoreOffer"), scoreOverall: avg("scoreOverall") };
  const all = count ? round1(rows.reduce((a, r) => a + r.scoreHeadline + r.scoreStory + r.scoreOffer + r.scoreOverall, 0) / (count * 4)) : null;
  return { ...out, overall: all };
}

/** The UTC offset of a time zone at an instant, in minutes (US Eastern: -300 or -240). */
export function zoneOffsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour") % 24, n("minute"), n("second"));
  return Math.round((wall - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** A wall-clock time in a zone ("2026-11-19", "15:30") → the UTC instant. DST-safe. */
export function zonedToUtc(day: string, hhmm: string, timeZone: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const [h, mi] = hhmm.split(":").map(Number) as [number, number];
  const wall = Date.UTC(y, m - 1, d, h, mi);
  let ts = wall;
  for (let i = 0; i < 2; i += 1) ts = wall - zoneOffsetMinutes(new Date(ts), timeZone) * 60000;
  return new Date(ts);
}

/** UTC instant → "YYYY-MM-DDTHH:mm" in a zone, for a datetime-local input. */
export function toZonedInput(at: Date, timeZone: string): string {
  const shifted = new Date(at.getTime() + zoneOffsetMinutes(at, timeZone) * 60000);
  return shifted.toISOString().slice(0, 16);
}

/** Default deadline: two business days after today, at 3:30 pm in the team's zone. */
export function defaultDeadline(now: Date, timeZone = "America/New_York"): Date {
  let day = toZonedInput(now, timeZone).slice(0, 10);
  for (let added = 0; added < 2; ) {
    day = addDays(day, 1);
    const dow = weekday(day);
    if (dow !== 0 && dow !== 6) added += 1;
  }
  return zonedToUtc(day, "15:30", timeZone);
}

export function formatDeadline(at: Date, timeZone = "America/New_York"): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(at);
}

/** Tokens are 32 lowercase hex characters (128 bits). */
export function isToken(value: string): boolean {
  return /^[0-9a-f]{32}$/.test(value);
}

/** A file name that is safe inside a zip and a Content-Disposition header. */
export function safeFilename(name: string, fallback = "file"): string {
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 150);
  return clean || fallback;
}

/** Revision file name inside the zip: "<reviewer> - <original name>", de-duplicated. */
export function zipEntryNames(rows: { reviewerName: string; filename: string }[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const base = safeFilename(`${row.reviewerName} - ${row.filename}`);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    if (n === 1) return base;
    const dot = base.lastIndexOf(".");
    return dot > 0 ? `${base.slice(0, dot)} (${n})${base.slice(dot)}` : `${base} (${n})`;
  });
}
