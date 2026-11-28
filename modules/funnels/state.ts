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
 *   5. progression lock  scheduled / watch % / URL key (never day 1, never live days);
 *                        with keyForceUnlock the link key also opens a scheduled / watch % lock
 *   6. video             the day's video is in
 *   7. replay pending    a live day after its session, replay not uploaded yet
 *   8. coming soon       build-as-you-go: no video yet
 *
 * Then, with lockPassedModules, a module whose video is open locks again ("passed")
 * once a LATER module's video is open, so a viewer only ever has the newest one.
 * Live modules never pass and never make another module pass.
 *
 * With an access window (accessHours), a non-live module that has opened locks again
 * ("expired") that many hours later, and an open one carries its expiresAt (the episode
 * countdown). Expiry sits between progression and "video" in the order above.
 */

export const FUNNEL_MODES = ["evergreen", "live"] as const;
export const TIMING_MODES = ["fixed", "per_viewer"] as const;
export const PROGRESSIONS = ["all_open", "scheduled", "watch_percent", "url_key"] as const;
export const CLOSE_MODES = ["page", "redirect", "never"] as const;
export const LIVE_OVERRIDES = ["auto", "on", "off"] as const;
export const SITE_TYPES = ["launch", "microsite"] as const;
export const BETWEEN_SESSIONS = ["hybrid", "recent", "next"] as const;

export type FunnelMode = (typeof FUNNEL_MODES)[number];
export type TimingMode = (typeof TIMING_MODES)[number];
export type Progression = (typeof PROGRESSIONS)[number];
export type CloseMode = (typeof CLOSE_MODES)[number];
export type LiveOverride = (typeof LIVE_OVERRIDES)[number];
export type SiteType = (typeof SITE_TYPES)[number];
export type BetweenSessions = (typeof BETWEEN_SESSIONS)[number];

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
  /** The first module follows scheduled / link-key progression too, instead of opening at the start. */
  lockFirstModule?: boolean;
  /**
   * Scheduled / watch % progression: a module's secret link (?k=…) also opens it
   * early, so an email can force-unlock it before its time. Link-key progression
   * always works this way.
   */
  keyForceUnlock?: boolean;
  /**
   * A module locks again once a later module's video is open for this viewer (the
   * nav shows it locked, or hides it; see the Funnel row's hidePassedModules).
   * Live modules are left alone.
   */
  lockPassedModules?: boolean;
  /**
   * Episode access window (docuseries): each non-live module stays open this many hours
   * after it opens for the viewer, then locks as "expired". Null / 0 = modules never expire.
   * A module's open time is the start (first module, or all-open funnels) or its scheduled
   * unlock; watch % and link-key modules have no fixed open time, so they never expire.
   */
  accessHours?: number | null;
  /**
   * Live funnels, where the front door goes between sessions:
   *   hybrid (default)  the most recent session, until the calendar day of the next one; that day, the next one
   *   recent            always the most recent session (its replay / replay pending)
   *   next              always the next session to come
   */
  betweenSessions?: BetweenSessions;
  /** Calendar days ("today") are worked out in this zone. Default America/New_York. */
  timeZone?: string;
};

export type DayRules = {
  id: string;
  position: number;
  hasVideo: boolean;
  unlockOffsetHours: number;
  /** Scheduled progression: an exact moment, which wins over the offset. */
  unlockAt: Date | null;
  unlockKey: string;
  /** Per-module override of the funnel's accessHours (null = use the funnel's). */
  accessHours?: number | null;
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

export type LockReason = "not_started" | "live_upcoming" | "scheduled" | "watch" | "key" | "passed" | "expired";

export type DayState =
  | { kind: "closed" }
  | { kind: "live"; url: string | null }
  | { kind: "locked"; reason: LockReason; unlockAt: Date | null; prevPosition?: number; nextPosition?: number; expiredAt?: Date }
  /** expiresAt: set when the funnel has an access window (accessHours). */
  | { kind: "video"; expiresAt?: Date }
  | { kind: "replay_pending" }
  | { kind: "coming_soon" };

/** A live session with no (valid) end is treated as running this long. */
export const DEFAULT_LIVE_HOURS = 3;
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
    case "url_key":
      return hasKey(day, viewer, presentedKeys) ? null : { kind: "locked", reason: "key", unlockAt: null };
  }
}

/** The viewer holds this day's link key: remembered in the cookie, or the ?k= on this request. */
function hasKey(day: DayRules, viewer: ViewerFacts, presentedKeys: Record<string, string>): boolean {
  if (viewer.keys.includes(day.id)) return true;
  const presented = presentedKeys[day.id];
  return Boolean(presented && day.unlockKey && presented === day.unlockKey);
}

/** Does a module's link key open it under this funnel's rule? */
export function keyUnlocks(funnel: { progression: string; keyForceUnlock?: boolean | null }): boolean {
  return funnel.progression === "url_key" || (Boolean(funnel.keyForceUnlock) && (funnel.progression === "scheduled" || funnel.progression === "watch_percent"));
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
  const states = ordered.map((day, index): DayState => {
    const liveDay = isLiveDay(funnel, day);
    // Progression applies to every module but the first (unless lockFirstModule); never to live days.
    const followsProgression = (index > 0 || Boolean(funnel.lockFirstModule)) && !liveDay;
    // Live now beats everything but "closed": a forced-on session is live even before the start.
    if (isLiveNow(funnel, day, now)) return { kind: "live", url: day.liveUrl || funnel.livestreamUrl };
    // A live session still to come counts down to ITS OWN time, even before the funnel start.
    if (liveDay && day.liveOverride === "auto" && day.liveStartAt && now < day.liveStartAt) {
      return { kind: "locked", reason: "live_upcoming", unlockAt: day.liveStartAt };
    }
    // Before the start nothing opens, except live sessions with a time: those follow only their
    // session (once it has happened the module opens: replay or replay pending).
    if (beforeStart && !(liveDay && day.liveStartAt)) {
      const own = funnel.progression === "scheduled" && followsProgression ? scheduledUnlock(day, start) ?? start : start;
      return { kind: "locked", reason: "not_started", unlockAt: own };
    }
    if (followsProgression && !(keyUnlocks(funnel) && hasKey(day, viewer, presentedKeys))) {
      const lock = progressionLock(funnel, day, ordered[index - 1], viewer, start, now, presentedKeys);
      if (lock) return lock;
    }
    if (!liveDay) {
      const expiresAt = accessExpiry(funnel, day, followsProgression, start);
      if (expiresAt && now >= expiresAt) return { kind: "locked", reason: "expired", unlockAt: null, expiredAt: expiresAt };
      if (expiresAt && day.hasVideo) return { kind: "video", expiresAt };
    }
    if (day.hasVideo) return { kind: "video" };
    if (liveDay) return { kind: "replay_pending" };
    return { kind: "coming_soon" };
  });
  return funnel.lockPassedModules ? lockPassed(funnel, ordered, states) : states;
}

/**
 * Episode access window: when an open, non-live module stops being available, or null
 * when it never expires. The window runs from the moment the module opened for this viewer.
 */
export function accessExpiry(funnel: FunnelRules, day: DayRules, followsProgression: boolean, start: Date | null): Date | null {
  const hours = day.accessHours && day.accessHours > 0 ? day.accessHours : funnel.accessHours && funnel.accessHours > 0 ? funnel.accessHours : 0;
  if (!hours) return null;
  const openedAt = !followsProgression || funnel.progression === "all_open" ? start : funnel.progression === "scheduled" ? scheduledUnlock(day, start) : null;
  return openedAt ? new Date(openedAt.getTime() + hours * HOUR) : null;
}

/**
 * lockPassedModules: every non-live module with its video open locks ("passed") when a
 * later non-live module has its video open too. It points at the newest open one.
 */
function lockPassed(funnel: FunnelRules, ordered: readonly DayRules[], states: DayState[]): DayState[] {
  let newest = -1;
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    if (states[index]!.kind === "video" && !isLiveDay(funnel, ordered[index]!)) {
      newest = index;
      break;
    }
  }
  if (newest <= 0) return states;
  const nextPosition = ordered[newest]!.position;
  return states.map((state, index) =>
    index < newest && state.kind === "video" && !isLiveDay(funnel, ordered[index]!) ? { kind: "locked", reason: "passed", unlockAt: null, nextPosition } : state,
  );
}

/** The newest module a viewer can watch when earlier ones have passed, or undefined. */
export function newestOpenModule(days: readonly DayRules[], states: readonly DayState[]): DayRules | undefined {
  const ordered = orderDays(days);
  const passed = states.find((state) => state.kind === "locked" && state.reason === "passed");
  if (!passed || passed.kind !== "locked" || !passed.nextPosition) return undefined;
  return ordered.find((day) => day.position === passed.nextPosition);
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
  // Once a live session has happened the funnel is underway: no more waitlist.
  const underway = funnel.mode === "live" && states.some(isOpen);
  if (funnel.waitlistEnabled && start && now < start && !underway) return { kind: "waitlist", startAt: start };
  if (funnel.mode === "live") {
    let recent: DayRules | undefined;
    for (let index = ordered.length - 1; index >= 0; index -= 1) {
      if (isOpen(states[index]!)) {
        recent = ordered[index];
        break;
      }
    }
    const next = nextSession(funnel, ordered, now);
    const rule = funnel.betweenSessions ?? "hybrid";
    const zone = funnel.timeZone ?? DEFAULT_ZONE;
    const pick =
      rule === "recent" ? recent ?? next : rule === "next" ? next ?? recent : next && dayKey(next.liveStartAt!, zone) === dayKey(now, zone) ? next : recent ?? next;
    if (pick) return { kind: "day", position: pick.position };
  }
  // Earlier modules have passed: the front door goes to the one that is open now.
  const newest = newestOpenModule(ordered, states);
  if (newest) return { kind: "day", position: newest.position };
  // Episode access windows: the newest open episode; between episodes, the next one's
  // countdown; once every episode has expired, the funnel is over for this viewer.
  if (states.some((state) => state.kind === "locked" && state.reason === "expired")) {
    for (let index = ordered.length - 1; index >= 0; index -= 1) {
      if (isOpen(states[index]!)) return { kind: "day", position: ordered[index]!.position };
    }
    const upcoming = ordered.find((_, index) => {
      const state = states[index]!;
      return state.kind === "locked" && state.reason !== "expired";
    });
    if (upcoming) return { kind: "day", position: upcoming.position };
    return { kind: "closed" };
  }
  return { kind: "day", position: ordered[0]?.position ?? 1 };
}

export const DEFAULT_ZONE = "America/New_York";

/** "2026-10-05": the calendar day of an instant in a time zone (DST-aware). */
export function dayKey(date: Date, timeZone: string = DEFAULT_ZONE): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: DEFAULT_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  }
}

/**
 * For a live module still to come: the earliest EARLIER session (by start time)
 * that is not over yet, live now or still ahead. While one exists the later
 * module shows no countdown of its own; if that session is today, the page
 * points people to it instead.
 */
export function earlierPendingSession(funnel: FunnelRules, days: readonly DayRules[], day: DayRules, now: Date): DayRules | undefined {
  if (funnel.mode !== "live" || !day.liveStartAt) return undefined;
  return days
    .filter((other) => other.id !== day.id && other.isLive && other.liveStartAt && other.liveStartAt < day.liveStartAt! && other.liveOverride !== "off")
    .filter((other) => isLiveNow(funnel, other, now) || (other.liveOverride === "auto" && liveWindow(other).end! > now))
    .sort((a, b) => a.liveStartAt!.getTime() - b.liveStartAt!.getTime())[0];
}

/** The next live session that has not started (automatic schedule only). */
export function nextSession(funnel: FunnelRules, days: readonly DayRules[], now: Date): DayRules | undefined {
  if (funnel.mode !== "live") return undefined;
  return days
    .filter((day) => day.isLive && day.liveOverride === "auto" && day.liveStartAt && day.liveStartAt > now)
    .sort((a, b) => a.liveStartAt!.getTime() - b.liveStartAt!.getTime())[0];
}

/** Fill a locked-day message: {day} {prev_day} {next_day} {percent} {unlock_date}. */
export function fillLockMessage(template: string, tokens: { day: string; prevDay?: string; nextDay?: string; percent: number; unlockDate?: string }): string {
  return template
    .replaceAll("{day}", tokens.day)
    .replaceAll("{prev_day}", tokens.prevDay ?? "the previous video")
    .replaceAll("{next_day}", tokens.nextDay ?? "the next video")
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
