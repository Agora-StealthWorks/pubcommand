/**
 * Time-zone helpers. Admins type wall-clock times in the organization's time
 * zone (org_settings.timezone, default America/New_York); everything is stored
 * as UTC. Public pages show the same zone, labelled, so every viewer sees the
 * wall clock the emails use. DST-aware through Intl.
 */
export const DEFAULT_TIMEZONE = "America/New_York";

export function isTimeZone(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function safeZone(value: string | null | undefined): string {
  return isTimeZone(value) ? value : DEFAULT_TIMEZONE;
}

/** Minutes the zone is ahead of UTC at an instant (e.g. -240 for New York in summer). */
export function zoneOffsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value ?? 0);
  const wall = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour") % 24, part("minute"), part("second"));
  return Math.round((wall - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/**
 * "2026-11-03T20:00" typed in `timeZone` -> the UTC instant. Null when the text
 * is not a wall-clock time. A time inside a spring-forward gap lands just after it.
 */
export function zonedLocalToUtc(local: string | null | undefined, timeZone: string): Date | null {
  if (!local) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(local.trim());
  if (!match) return null;
  const [year, month, day, hour, minute] = [match[1], match[2], match[3], match[4] ?? "00", match[5] ?? "00"].map(Number) as [number, number, number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(naive);
  if (check.getUTCDate() !== day) return null;
  // Two passes so an instant near a DST switch picks the offset in force then.
  let guess = naive - zoneOffsetMinutes(new Date(naive), timeZone) * 60_000;
  guess = naive - zoneOffsetMinutes(new Date(guess), timeZone) * 60_000;
  return new Date(guess);
}

/** UTC instant -> "2026-11-03T20:00" wall clock in `timeZone`, for <input type="datetime-local">. */
export function utcToZonedLocal(date: Date | null | undefined, timeZone: string): string {
  if (!date || Number.isNaN(date.getTime())) return "";
  const shifted = new Date(date.getTime() + zoneOffsetMinutes(date, timeZone) * 60_000);
  return shifted.toISOString().slice(0, 16);
}

/** "2026-11-03" calendar day of an instant in `timeZone`. */
export function zonedDayKey(date: Date, timeZone: string): string {
  return utcToZonedLocal(date, timeZone).slice(0, 10);
}

/** Short zone label for the instant, e.g. "EST" / "EDT" / "CST" or "GMT+1". */
export function zoneLabel(date: Date, timeZone: string): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
    .formatToParts(date)
    .find((item) => item.type === "timeZoneName");
  return part?.value ?? timeZone;
}

/** "Tuesday, November 3 at 8:00 PM EST" */
export function formatZoned(date: Date | null | undefined, timeZone: string, options: { weekday?: boolean; year?: boolean } = {}): string {
  if (!date) return "";
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: options.weekday === false ? undefined : "long",
    month: "long",
    day: "numeric",
    year: options.year ? "numeric" : undefined,
  }).format(date);
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(date);
  return `${day} at ${time} ${zoneLabel(date, timeZone)}`;
}

/** "Nov 3, 2026" */
export function formatZonedDate(date: Date | null | undefined, timeZone: string): string {
  if (!date) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" }).format(date);
}
