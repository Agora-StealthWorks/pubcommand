import { CronExpressionParser } from "cron-parser";

/** The most recent scheduled time at or before `now`, or null for a bad expression. */
export function lastSlot(schedule: string, now: Date, timeZone = "America/New_York"): Date | null {
  try {
    const expression = CronExpressionParser.parse(schedule, { currentDate: new Date(now.getTime() + 1), tz: timeZone });
    return expression.prev().toDate();
  } catch {
    return null;
  }
}

/** The next scheduled time after `now`, or null for a bad expression. */
export function nextSlot(schedule: string, now: Date, timeZone = "America/New_York"): Date | null {
  try {
    return CronExpressionParser.parse(schedule, { currentDate: now, tz: timeZone }).next().toDate();
  } catch {
    return null;
  }
}

/** True when a slot is recent enough to run now (missed slots older than this are skipped, not replayed). */
export function slotIsDue(slot: Date, now: Date, graceMs = 6 * 60 * 60 * 1000): boolean {
  const age = now.getTime() - slot.getTime();
  return age >= 0 && age <= graceMs;
}
