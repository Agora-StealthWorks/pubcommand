/** Calendar-day helpers. A "day" is an ISO string "YYYY-MM-DD" with no time zone. */

const DAY_MS = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function isDay(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** A Date stored as DATE (UTC midnight) → "YYYY-MM-DD". */
export function toDay(date: Date | null | undefined): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

/** "YYYY-MM-DD" → Date at UTC midnight (what Prisma writes to a DATE column). */
export function fromDay(day: string | null | undefined): Date | null {
  return isDay(day) ? new Date(`${day}T00:00:00Z`) : null;
}

export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from a to b (b - a). */
export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** Add months, clamping to the last day of the target month (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(day: string, months: number, anchorDayOfMonth?: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(anchorDayOfMonth ?? d, last));
  return target.toISOString().slice(0, 10);
}

/** Today in a time zone (default US Eastern, where the team works). */
export function todayIn(timeZone = "America/New_York", now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** "2026-11-17" → "Nov 17". */
export function fmtDay(day: string | null | undefined): string {
  if (!isDay(day)) return "—";
  const [, m, d] = day.split("-").map(Number) as [number, number, number];
  return `${MONTHS[m - 1]} ${d}`;
}

/** "2026-11-17" → "Nov 17, 2026". */
export function fmtDayFull(day: string | null | undefined): string {
  if (!isDay(day)) return "—";
  return `${fmtDay(day)}, ${day.slice(0, 4)}`;
}

/** "14:30" → "2:30pm". */
export function fmtTime(hhmm: string | null | undefined): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? "");
  if (!match) return "";
  const h = Number(match[1]);
  const m = Number(match[2]);
  const suffix = h < 12 ? "am" : "pm";
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${suffix}`;
}

/** The six-week (or five) grid of days covering a month, starting on Sunday. */
export function monthGrid(month: string): string[] {
  const first = `${month}-01`;
  const start = addDays(first, -weekday(first));
  const lastOfMonth = addMonths(first, 1, 1);
  const end = addDays(lastOfMonth, -1);
  const days: string[] = [];
  for (let day = start; day <= end || days.length % 7 !== 0; day = addDays(day, 1)) days.push(day);
  return days;
}

export function isMonth(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1]} ${y}`;
}

export function shiftMonth(month: string, delta: number): string {
  return addMonths(`${month}-01`, delta, 1).slice(0, 7);
}
