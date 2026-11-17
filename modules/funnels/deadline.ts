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

/** Page kinds the deadline bar can show on. The close page never shows it. */
export const DEADLINE_PAGES = ["home", "waitlist", "day", "custom"] as const;
export type DeadlinePage = (typeof DEADLINE_PAGES)[number];
export const DEADLINE_PAGE_LABELS: Record<DeadlinePage, string> = { home: "Home page", waitlist: "Waitlist", day: "Day pages", custom: "Custom pages" };

/** Only known page kinds, in order. An empty list means the bar shows nowhere. */
export function normalizeDeadlinePages(value: unknown): DeadlinePage[] {
  const list = Array.isArray(value) ? value : [];
  return DEADLINE_PAGES.filter((page) => list.includes(page));
}

export function deadlineShowsOn(pages: unknown, page: DeadlinePage): boolean {
  return normalizeDeadlinePages(pages).includes(page);
}

/**
 * The bar button's link: "module:<n>" → that day's page, an http(s) URL as is,
 * anything else → no button.
 */
export function deadlineButtonHref(target: string, base: string, carry = ""): string | null {
  const value = target.trim();
  const module = /^module:(\d{1,3})$/.exec(value);
  if (module) return `${base}/day-${Number(module[1])}${carry}`;
  return /^https?:\/\/[^\s<>"]+$/i.test(value) ? value : null;
}

/** Validate the button target on save ("" = none). */
export function normalizeDeadlineButtonUrl(value: string): string {
  const text = value.trim().slice(0, 500);
  return /^module:\d{1,3}$/.test(text) || /^https?:\/\/[^\s<>"]+$/i.test(text) ? text : "";
}

/**
 * The sessionStorage key a dismissal is remembered under. It includes the
 * deadline, so moving the deadline shows the bar again to people who hid it.
 */
export function dismissKey(funnelId: string, at: number): string {
  return `pcf-deadline-${funnelId.replace(/[^a-z0-9]/gi, "").slice(0, 32)}-${Math.floor(at / 1000)}`;
}

/** Was the bar hidden for this deadline? (Storage values other than "1" do not count.) */
export function isDismissed(storage: { getItem(key: string): string | null } | null, key: string): boolean {
  try {
    return storage?.getItem(key) === "1";
  } catch {
    return false;
  }
}

/** Remember a dismissal; storage may be unavailable (private mode), which is fine. */
export function rememberDismiss(storage: { setItem(key: string, value: string): void } | null, key: string): void {
  try {
    storage?.setItem(key, "1");
  } catch {
    // Storage is blocked: the bar stays hidden for this page view only.
  }
}
