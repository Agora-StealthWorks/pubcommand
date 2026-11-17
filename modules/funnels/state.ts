/**
 * The launch-funnel state engine. PURE: no database, no clock, no cookies. The
 * public day page, the entry router, the stats sync route and the tests all ask
 * it the same question ("what does this day show right now?") and so can never
 * disagree.
 *
 * Precedence for a day, highest first:
 *   1. closed            the funnel has closed (for everyone, or for this viewer)
 *   2. live now          a live session is running: send people to the room
 *   3. not started       the funnel's start is still ahead
 *   4. live upcoming     a live day whose session has not begun
 *   5. progression lock  scheduled / watch % / URL key (never day 1, never live days)
 *   6. video             the day's video is in
 *   7. replay pending    a live day after its session, replay not uploaded yet
 *   8. coming soon       build-as-you-go: no video yet
 */

export const FUNNEL_MODES = ["evergreen", "live"] as const;
export const TIMING_MODES = ["fixed", "per_viewer"] as const;
export const PROGRESSIONS = ["all_open", "scheduled", "watch_percent", "url_key"] as const;
export const CLOSE_MODES = ["page", "redirect", "never"] as const;
export const LIVE_OVERRIDES = ["auto", "on", "off"] as const;
export const SITE_TYPES = ["launch", "microsite"] as const;

export type FunnelMode = (typeof FUNNEL_MODES)[number];
export type TimingMode = (typeof TIMING_MODES)[number];
export type Progression = (typeof PROGRESSIONS)[number];
export type CloseMode = (typeof CLOSE_MODES)[number];
export type LiveOverride = (typeof LIVE_OVERRIDES)[number];
export type SiteType = (typeof SITE_TYPES)[number];

export const SITE_TYPE_LABELS: Record<SiteType, string> = {
  launch: "Launch funnel",
  microsite: "Microsite",
};

export const PROGRESSION_LABELS: Record<Progression, string> = {
  all_open: "All open",
  scheduled: "Unlock on a schedule",
  watch_percent: "Unlock after watching the previous day",
  url_key: "Unlock with a link key",
};

export type FunnelRules = {
  mode: FunnelMode;
  timing: TimingMode;
  startAt: Date | null;
  endAt: Date | null;
  /** Per-viewer timing: hours after a viewer's first visit that the funnel closes for them. */
  closeAfterHours: number | null;
  closeMode: CloseMode;
  progression: Progression;
  watchPercent: number;
  livestreamUrl: string | null;
  waitlistEnabled: boolean;
  /** Microsite: the front door is the block-built home page. Default launch. */
  siteType?: SiteType;
};

export type DayRules = {
  id: string;
  position: number;
  hasVideo: boolean;
  unlockOffsetHours: number;
  /** Scheduled progression: an exact moment, which wins over the offset. */
  unlockAt: Date | null;
  unlockKey: string;
  isLive: boolean;
  liveStartAt: Date | null;
  liveEndAt: Date | null;
  liveUrl: string | null;
  liveOverride: LiveOverride;
};

/** What we know about an anonymous viewer (from the signed cookie). */
export type ViewerFacts = {
  /** Per-viewer clock start, ms since epoch. */
  start?: number;
  /** Highest watched percent per day id. */
  watched: Record<string, number>;
  /** Day ids unlocked with their URL key. */
  keys: string[];
};

export type LockReason = "not_started" | "live_upcoming" | "scheduled" | "watch" | "key";

export type DayState =
  | { kind: "closed" }
  | { kind: "live"; url: string | null }
  | { kind: "locked"; reason: LockReason; unlockAt: Date | null; prevPosition?: number }
  | { kind: "video" }
  | { kind: "replay_pending" }
  | { kind: "coming_soon" };

/** A live session with no (valid) end is treated as running this long. */
export const DEFAULT_LIVE_HOURS = 2;
const HOUR = 3_600_000;

export const emptyViewer = (): ViewerFacts => ({ watched: {}, keys: [] });

/** When the funnel starts for this viewer. Live funnels always share one clock. */
export function effectiveStart(funnel: FunnelRules, viewer: ViewerFacts, now: Date): Date | null {
  if (funnel.mode === "live" || funnel.timing === "fixed") return funnel.startAt;
  return new Date(viewer.start ?? now.getTime());
}

/** When the funnel closes for this viewer, or null when it never does. */
export function effectiveEnd(funnel: FunnelRules, viewer: ViewerFacts, now: Date): Date | null {
  if (funnel.closeMode === "never") return null;
  if (funnel.mode === "live" || funnel.timing === "fixed") return funnel.endAt;
  if (!funnel.closeAfterHours || funnel.closeAfterHours <= 0) return null;
  const start = effectiveStart(funnel, viewer, now)!;
  return new Date(start.getTime() + funnel.closeAfterHours * HOUR);
}

export function isClosed(funnel: FunnelRules, viewer: ViewerFacts, now: Date): boolean {
  const end = effectiveEnd(funnel, viewer, now);
  return Boolean(end) && now >= end!;
}

export function liveWindow(day: Pick<DayRules, "liveStartAt" | "liveEndAt">): { start: Date | null; end: Date | null } {
  const start = day.liveStartAt;
  if (!start) return { start: null, end: null };
  const end = day.liveEndAt && day.liveEndAt > start ? day.liveEndAt : new Date(start.getTime() + DEFAULT_LIVE_HOURS * HOUR);
  return { start, end };
}

function isLiveDay(funnel: FunnelRules, day: DayRules): boolean {
  return funnel.mode === "live" && day.isLive;
}

export function isLiveNow(funnel: FunnelRules, day: DayRules, now: Date): boolean {
  if (!isLiveDay(funnel, day)) return false;
  if (day.liveOverride === "on") return true;
  if (day.liveOverride === "off") return false;
  const { start, end } = liveWindow(day);
  return Boolean(start && end) && now >= start! && now < end!;
}

/** Scheduled progression: the day's own moment, else start + offset hours. */
export function scheduledUnlock(day: Pick<DayRules, "unlockAt" | "unlockOffsetHours">, start: Date | null): Date | null {
  if (day.unlockAt) return day.unlockAt;
  return start ? new Date(start.getTime() + Math.max(0, day.unlockOffsetHours) * HOUR) : null;
}

function later(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function progressionLock(
  funnel: FunnelRules,
  day: DayRules,
  previous: DayRules | undefined,
  viewer: ViewerFacts,
  start: Date | null,
  now: Date,
  presentedKeys: Record<string, string>,
): DayState | null {
  switch (funnel.progression) {
    case "all_open":
      return null;
    case "scheduled": {
      const at = scheduledUnlock(day, start);
      return at && now < at ? { kind: "locked", reason: "scheduled", unlockAt: at } : null;
    }
    case "watch_percent": {
      if (!previous) return null;
      const watched = viewer.watched[previous.id] ?? 0;
      return watched >= funnel.watchPercent ? null : { kind: "locked", reason: "watch", unlockAt: null, prevPosition: previous.position };
    }
    case "url_key": {
      if (viewer.keys.includes(day.id)) return null;
      const presented = presentedKeys[day.id];
      if (presented && day.unlockKey && presented === day.unlockKey) return null;
      return { kind: "locked", reason: "key", unlockAt: null };
    }
  }
}

export function orderDays<T extends { position: number }>(days: readonly T[]): T[] {
  return [...days].sort((a, b) => a.position - b.position);
}

/**
 * The state of every day, in position order.
 * `presentedKeys` is day id -> the ?k= key on THIS request, counted as if stored.
 */
export function computeDayStates(
  funnel: FunnelRules,
  days: readonly DayRules[],
  viewer: ViewerFacts,
  now: Date,
  presentedKeys: Record<string, string> = {},
): DayState[] {
  const ordered = orderDays(days);
  if (isClosed(funnel, viewer, now)) return ordered.map(() => ({ kind: "closed" }));
  const start = effectiveStart(funnel, viewer, now);
  const beforeStart = Boolean(start) && now < start!;
  return ordered.map((day, index) => {
    const liveDay = isLiveDay(funnel, day);
    if (isLiveNow(funnel, day, now)) return { kind: "live", url: day.liveUrl || funnel.livestreamUrl };
    if (beforeStart) {
      const own = liveDay ? day.liveStartAt : funnel.progression === "scheduled" && index > 0 ? scheduledUnlock(day, start) : null;
      return { kind: "locked", reason: "not_started", unlockAt: later(start, own) };
    }
    if (liveDay && day.liveOverride === "auto" && day.liveStartAt && now < day.liveStartAt) {
      return { kind: "locked", reason: "live_upcoming", unlockAt: day.liveStartAt };
    }
    // Day 1 is never progression-locked; live days follow their session times instead.
    if (index > 0 && !liveDay) {
      const lock = progressionLock(funnel, day, ordered[index - 1], viewer, start, now, presentedKeys);
      if (lock) return lock;
    }
    if (day.hasVideo) return { kind: "video" };
    if (liveDay) return { kind: "replay_pending" };
    return { kind: "coming_soon" };
  });
}

/** Open = the visitor may see this day's page content (not locked, not closed). */
export function isOpen(state: DayState): boolean {
  return state.kind === "video" || state.kind === "live" || state.kind === "replay_pending" || state.kind === "coming_soon";
}

export type EntryDecision =
  | { kind: "closed" }
  | { kind: "home" }
  | { kind: "waitlist"; startAt: Date }
  | { kind: "day"; position: number };

/**
 * Where the funnel's front door sends someone right now:
 *   closed -> close page (or redirect); a microsite -> its home page (always,
 *   until it closes; the modules sit around it); a live session running -> that day;
 *   before the start with a waitlist -> the waitlist countdown;
 *   live funnel -> the most recent day that has opened, else the next session;
 *   evergreen -> day 1.
 */
export function entryDecision(funnel: FunnelRules, days: readonly DayRules[], viewer: ViewerFacts, now: Date): EntryDecision {
  const ordered = orderDays(days);
  if (isClosed(funnel, viewer, now)) return { kind: "closed" };
  if (funnel.siteType === "microsite") return { kind: "home" };
  const states = computeDayStates(funnel, ordered, viewer, now);
  const liveIndex = states.findIndex((state) => state.kind === "live");
  if (liveIndex >= 0) return { kind: "day", position: ordered[liveIndex]!.position };
  const start = effectiveStart(funnel, viewer, now);
  if (start && now < start && funnel.waitlistEnabled) return { kind: "waitlist", startAt: start };
  if (funnel.mode === "live") {
    for (let index = ordered.length - 1; index >= 0; index -= 1) {
      if (isOpen(states[index]!)) return { kind: "day", position: ordered[index]!.position };
    }
    const next = nextSession(funnel, ordered, now);
    if (next) return { kind: "day", position: next.position };
  }
  return { kind: "day", position: ordered[0]?.position ?? 1 };
}

/** The next live session that has not started (automatic schedule only). */
export function nextSession(funnel: FunnelRules, days: readonly DayRules[], now: Date): DayRules | undefined {
  if (funnel.mode !== "live") return undefined;
  return days
    .filter((day) => day.isLive && day.liveOverride === "auto" && day.liveStartAt && day.liveStartAt > now)
    .sort((a, b) => a.liveStartAt!.getTime() - b.liveStartAt!.getTime())[0];
}

/** Fill a locked-day message: {day} {prev_day} {percent} {unlock_date}. */
export function fillLockMessage(template: string, tokens: { day: string; prevDay?: string; percent: number; unlockDate?: string }): string {
  return template
    .replaceAll("{day}", tokens.day)
    .replaceAll("{prev_day}", tokens.prevDay ?? "the previous video")
    .replaceAll("{percent}", String(tokens.percent))
    .replaceAll("{unlock_date}", tokens.unlockDate ?? "soon");
}

export type CtaReveal = "none" | "always" | "video_time" | "datetime";
export const CTA_REVEALS: readonly CtaReveal[] = ["none", "always", "video_time", "datetime"];

/**
 * Server-side half of the timed call to action. "video_time" is decided in the
 * browser once playback passes the mark; the server only says it is pending.
 */
export function ctaVisibility(cta: { reveal: CtaReveal; text: string; url: string; at: Date | null }, now: Date): "hidden" | "shown" | "after_video_time" {
  if (cta.reveal === "none" || !cta.text.trim() || !cta.url.trim()) return "hidden";
  if (cta.reveal === "always") return "shown";
  if (cta.reveal === "datetime") return cta.at && now >= cta.at ? "shown" : "hidden";
  return "after_video_time";
}
