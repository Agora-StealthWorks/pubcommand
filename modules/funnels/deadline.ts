/**
 * The deadline bar: a site-wide countdown ribbon. PURE. Decides which moment it
 * counts down to (the funnel close, which is per viewer on an evergreen
 * per-viewer funnel; the start; or a set time) and from when it shows.
 */
import { effectiveEnd, effectiveStart, type FunnelRules, type ViewerFacts } from "./state";
import { formatZoned } from "./time";

export const DEADLINE_TARGETS = ["end", "start", "custom"] as const;
export type DeadlineTarget = (typeof DEADLINE_TARGETS)[number];

export type DeadlineBarConfig = {
  enabled: boolean;
  target: DeadlineTarget;
  /** The set time, for target "custom". */
  at: Date | null;
  /** Only show in the last N hours before the deadline (0 = always). */
  withinHours: number;
};

export type DeadlineBarTiming = {
  /** The moment the bar counts down to. */
  at: Date;
  /** When the bar appears (null = it shows now). The page hides it until then. */
  revealAt: Date | null;
};

const HOUR = 3_600_000;

/** The deadline this viewer sees, or null when the bar should not show at all (off, no date, or already passed). */
export function deadlineBar(funnel: FunnelRules, bar: DeadlineBarConfig, viewer: ViewerFacts, now: Date): DeadlineBarTiming | null {
  if (!bar.enabled) return null;
  const at = bar.target === "start" ? effectiveStart(funnel, viewer, now) : bar.target === "custom" ? bar.at : effectiveEnd(funnel, viewer, now);
  if (!at || Number.isNaN(at.getTime()) || at <= now) return null;
  const within = Math.max(0, Math.floor(bar.withinHours || 0));
  const revealAt = within > 0 ? new Date(at.getTime() - within * HOUR) : null;
  return { at, revealAt: revealAt && revealAt > now ? revealAt : null };
}

/** Is the bar visible right now (deadline ahead and inside the reveal window)? */
export function deadlineBarVisible(timing: DeadlineBarTiming | null, now: Date): boolean {
  if (!timing) return false;
  return now < timing.at && (!timing.revealAt || now >= timing.revealAt);
}

/** {date} → "Wednesday, November 11 at 2:00 PM EST", {short_date} → "11/11/2026", both in the org time zone. */
export function deadlineText(template: string, at: Date, timeZone: string): string {
  const short = new Intl.DateTimeFormat("en-US", { timeZone, month: "2-digit", day: "2-digit", year: "numeric" }).format(at);
  return template.replaceAll("{date}", formatZoned(at, timeZone)).replaceAll("{short_date}", short);
}
