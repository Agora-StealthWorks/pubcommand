/**
 * The launch-funnel rules, scenario by scenario: precedence, entry routing,
 * progression A/B/C/D, live sessions and the between-sessions front door.
 */
import { describe, expect, it } from "vitest";
import { computeDayStates, dayKey, earlierPendingSession, entryDecision, isClosed, keyUnlocks, type DayRules, type FunnelRules, type ViewerFacts } from "./state";

const HOUR = 3_600_000;
// 4 pm Eastern on Mon 12 Oct 2026 (EDT, UTC-4).
const T0 = new Date("2026-10-12T20:00:00Z");
const at = (hours: number) => new Date(T0.getTime() + hours * HOUR);

function funnel(overrides: Partial<FunnelRules> = {}): FunnelRules {
  return {
    mode: "evergreen",
    timing: "fixed",
    startAt: T0,
    endAt: at(24 * 7),
    closeAfterHours: null,
    closeMode: "page",
    progression: "all_open",
    watchPercent: 80,
    livestreamUrl: "https://room.example/live",
    waitlistEnabled: true,
    ...overrides,
  };
}

function day(position: number, overrides: Partial<DayRules> = {}): DayRules {
  return {
    id: `m${position}`,
    position,
    hasVideo: true,
    unlockOffsetHours: (position - 1) * 24,
    unlockAt: null,
    unlockKey: `secret${position}`,
    isLive: false,
    liveStartAt: null,
    liveEndAt: null,
    liveUrl: null,
    liveOverride: "auto",
    ...overrides,
  };
}

const nobody = (overrides: Partial<ViewerFacts> = {}): ViewerFacts => ({ watched: {}, keys: [], ...overrides });
const modules = [day(1), day(2), day(3)];
const kinds = (states: { kind: string }[]) => states.map((state) => state.kind);

describe("front door and the fixed clock", () => {
  it("before the start: the waitlist, and every module is locked as not started", () => {
    expect(entryDecision(funnel(), modules, nobody(), at(-3))).toEqual({ kind: "waitlist", startAt: T0 });
    const states = computeDayStates(funnel(), modules, nobody(), at(-3));
    expect(states.every((state) => state.kind === "locked" && state.reason === "not_started")).toBe(true);
  });

  it("without a waitlist, early visitors are sent to module 1 (locked)", () => {
    expect(entryDecision(funnel({ waitlistEnabled: false }), modules, nobody(), at(-3))).toEqual({ kind: "day", position: 1 });
  });

  it("after the start an evergreen funnel opens on module 1", () => {
    expect(entryDecision(funnel(), modules, nobody(), at(2))).toEqual({ kind: "day", position: 1 });
  });

  it("closes at the end time; never-close ignores it", () => {
    expect(isClosed(funnel(), nobody(), at(24 * 7))).toBe(true);
    expect(isClosed(funnel({ closeMode: "never" }), nobody(), at(24 * 30))).toBe(false);
    expect(entryDecision(funnel(), modules, nobody(), at(24 * 8))).toEqual({ kind: "closed" });
    expect(kinds(computeDayStates(funnel(), modules, nobody(), at(24 * 8)))).toEqual(["closed", "closed", "closed"]);
  });

  it("build as you go: an open module without a video is coming soon", () => {
    const states = computeDayStates(funnel(), [day(1), day(2, { hasVideo: false })], nobody(), at(1));
    expect(states[1]!.kind).toBe("coming_soon");
  });
});

describe("progression", () => {
  it("A: all open", () => {
    expect(kinds(computeDayStates(funnel(), modules, nobody(), at(1)))).toEqual(["video", "video", "video"]);
  });

  it("B: unlocks by offset hours from the start", () => {
    const states = computeDayStates(funnel({ progression: "scheduled" }), modules, nobody(), at(30));
    expect(kinds(states)).toEqual(["video", "video", "locked"]);
    expect(states[2]).toMatchObject({ reason: "scheduled", unlockAt: at(48) });
  });

  it("B: an exact unlock time wins over the offset", () => {
    const list = [day(1), day(2, { unlockOffsetHours: 1, unlockAt: at(50) })];
    const before = computeDayStates(funnel({ progression: "scheduled" }), list, nobody(), at(10));
    expect(before[1]).toMatchObject({ kind: "locked", unlockAt: at(50) });
    expect(computeDayStates(funnel({ progression: "scheduled" }), list, nobody(), at(51))[1]!.kind).toBe("video");
  });

  it("B before the start: a later module shows its own unlock time", () => {
    const states = computeDayStates(funnel({ progression: "scheduled" }), modules, nobody(), at(-2));
    expect(states[0]).toMatchObject({ reason: "not_started", unlockAt: T0 });
    expect(states[2]).toMatchObject({ reason: "not_started", unlockAt: at(48) });
  });

  it("B per viewer: offsets count from the viewer's first visit, and so does the close", () => {
    const rules = funnel({ timing: "per_viewer", startAt: null, endAt: null, closeAfterHours: 72, progression: "scheduled" });
    const viewer = nobody({ start: at(100).getTime() });
    expect(kinds(computeDayStates(rules, modules, viewer, at(125)))).toEqual(["video", "video", "locked"]);
    expect(isClosed(rules, viewer, at(171))).toBe(false);
    expect(isClosed(rules, viewer, at(172))).toBe(true);
  });

  it("C: watching the previous module to the threshold unlocks the next, one step at a time", () => {
    const rules = funnel({ progression: "watch_percent", watchPercent: 50 });
    let states = computeDayStates(rules, modules, nobody({ watched: { m1: 49 } }), at(1));
    expect(states[1]).toMatchObject({ kind: "locked", reason: "watch", prevPosition: 1 });
    states = computeDayStates(rules, modules, nobody({ watched: { m1: 50 } }), at(1));
    expect(kinds(states)).toEqual(["video", "video", "locked"]);
  });

  it("D: a stored or presented key unlocks; a wrong one does not", () => {
    const rules = funnel({ progression: "url_key" });
    expect(computeDayStates(rules, modules, nobody(), at(1))[1]!.kind).toBe("locked");
    expect(computeDayStates(rules, modules, nobody({ keys: ["m2"] }), at(1))[1]!.kind).toBe("video");
    expect(computeDayStates(rules, modules, nobody(), at(1), { m2: "secret2" })[1]!.kind).toBe("video");
    expect(computeDayStates(rules, modules, nobody(), at(1), { m2: "guess" })[1]!.kind).toBe("locked");
  });

  it("B + force-unlock: an email link opens a module before its time; without it the schedule still applies", () => {
    const rules = funnel({ timing: "per_viewer", startAt: null, progression: "scheduled", keyForceUnlock: true });
    const viewer = nobody({ start: T0.getTime() });
    expect(computeDayStates(rules, modules, viewer, at(1))[1]).toMatchObject({ kind: "locked", reason: "scheduled" });
    expect(computeDayStates(rules, modules, viewer, at(1), { m2: "secret2" })[1]!.kind).toBe("video");
    expect(computeDayStates(rules, modules, { ...viewer, keys: ["m3"] }, at(1))[2]!.kind).toBe("video");
    expect(computeDayStates(rules, modules, viewer, at(1), { m2: "guess" })[1]!.kind).toBe("locked");
    expect(computeDayStates(rules, modules, viewer, at(25))[1]!.kind).toBe("video");
  });

  it("C + force-unlock: an email link skips the watch requirement", () => {
    const rules = funnel({ progression: "watch_percent", keyForceUnlock: true });
    expect(computeDayStates(rules, modules, nobody(), at(1))[1]!.kind).toBe("locked");
    expect(computeDayStates(rules, modules, nobody({ keys: ["m2"] }), at(1))[1]!.kind).toBe("video");
  });

  it("without force-unlock, keys do nothing under B or C", () => {
    const rules = funnel({ progression: "scheduled" });
    expect(computeDayStates(rules, modules, nobody({ keys: ["m2"] }), at(1), { m2: "secret2" })[1]!.kind).toBe("locked");
    expect(keyUnlocks({ progression: "scheduled" })).toBe(false);
    expect(keyUnlocks({ progression: "scheduled", keyForceUnlock: true })).toBe(true);
    expect(keyUnlocks({ progression: "all_open", keyForceUnlock: true })).toBe(false);
    expect(keyUnlocks({ progression: "url_key" })).toBe(true);
  });

  it("module 1 is never progression-locked by default", () => {
    for (const progression of ["scheduled", "watch_percent", "url_key"] as const) {
      expect(computeDayStates(funnel({ progression }), modules, nobody(), at(1))[0]!.kind).toBe("video");
    }
  });

  it("lock the first module too: it follows its own unlock time or key", () => {
    const list = [day(1, { unlockAt: at(24) }), day(2, { unlockOffsetHours: 48 })];
    const rules = funnel({ progression: "scheduled", lockFirstModule: true });
    expect(computeDayStates(rules, list, nobody(), at(1))[0]).toMatchObject({ kind: "locked", reason: "scheduled" });
    expect(computeDayStates(rules, list, nobody(), at(25))[0]!.kind).toBe("video");
    const keyed = funnel({ progression: "url_key", lockFirstModule: true });
    expect(computeDayStates(keyed, modules, nobody(), at(1))[0]!.kind).toBe("locked");
    expect(computeDayStates(keyed, modules, nobody(), at(1), { m1: "secret1" })[0]!.kind).toBe("video");
  });

  it("live modules ignore progression", () => {
    const rules = funnel({ mode: "live", progression: "url_key" });
    const list = [day(1), day(2, { isLive: true, liveStartAt: at(-4), liveEndAt: at(-3) })];
    expect(computeDayStates(rules, list, nobody(), at(1))[1]!.kind).toBe("video");
  });
});

describe("live sessions", () => {
  const liveDay = (overrides: Partial<DayRules> = {}) => day(2, { isLive: true, hasVideo: false, liveStartAt: at(24), liveEndAt: at(26), ...overrides });

  it("upcoming → live (redirect) → replay pending → replay", () => {
    const rules = funnel({ mode: "live" });
    const list = [day(1), liveDay()];
    expect(computeDayStates(rules, list, nobody(), at(23))[1]).toMatchObject({ kind: "locked", reason: "live_upcoming", unlockAt: at(24) });
    expect(computeDayStates(rules, list, nobody(), at(25))[1]).toEqual({ kind: "live", url: "https://room.example/live" });
    expect(entryDecision(rules, list, nobody(), at(25))).toEqual({ kind: "day", position: 2 });
    expect(computeDayStates(rules, list, nobody(), at(27))[1]!.kind).toBe("replay_pending");
    expect(computeDayStates(rules, [day(1), liveDay({ hasVideo: true })], nobody(), at(27))[1]!.kind).toBe("video");
    expect(entryDecision(rules, list, nobody(), at(27))).toEqual({ kind: "day", position: 2 });
  });

  it("the day's own room wins over the funnel's", () => {
    const rules = funnel({ mode: "live" });
    expect(computeDayStates(rules, [liveDay({ liveUrl: "https://own.example" })], nobody(), at(25))[0]).toEqual({ kind: "live", url: "https://own.example" });
  });

  it("forced on is live even before the start; forced off never is", () => {
    const rules = funnel({ mode: "live" });
    expect(computeDayStates(rules, [day(1, { isLive: true, hasVideo: false, liveStartAt: at(5), liveOverride: "on" })], nobody(), at(-2))[0]!.kind).toBe("live");
    const off = [day(1, { isLive: true, hasVideo: false, liveStartAt: at(0), liveEndAt: at(2), liveOverride: "off" })];
    expect(computeDayStates(rules, off, nobody(), at(1))[0]!.kind).toBe("replay_pending");
  });

  it("a session with no end, or an end before its start, runs for 3 hours", () => {
    const rules = funnel({ mode: "live" });
    expect(computeDayStates(rules, [day(1, { isLive: true, hasVideo: false, liveStartAt: at(1), liveEndAt: at(0.5) })], nobody(), at(3.9))[0]!.kind).toBe("live");
    expect(computeDayStates(rules, [day(1, { isLive: true, hasVideo: false, liveStartAt: at(1) })], nobody(), at(4.1))[0]!.kind).toBe("replay_pending");
  });

  it("live funnels ignore per-viewer timing", () => {
    expect(entryDecision(funnel({ mode: "live", timing: "per_viewer" }), modules, nobody(), at(-1))).toEqual({ kind: "waitlist", startAt: T0 });
  });

  it("before the funnel start, a later session counts down to ITS time", () => {
    const rules = funnel({ mode: "live", startAt: at(1) });
    const list = [day(1, { isLive: true, liveStartAt: at(1) }), day(2, { isLive: true, liveStartAt: at(48) })];
    expect(computeDayStates(rules, list, nobody(), at(0.5))[1]).toMatchObject({ kind: "locked", reason: "live_upcoming", unlockAt: at(48) });
  });

  it("a session that already happened opens even when the funnel start is later, and the waitlist goes away", () => {
    const rules = funnel({ mode: "live", startAt: at(5) });
    const list = [day(1, { isLive: true, hasVideo: true, liveStartAt: at(1), liveEndAt: at(2) }), day(2, { isLive: true, hasVideo: false, liveStartAt: at(3), liveEndAt: at(4) })];
    const states = computeDayStates(rules, list, nobody(), at(2.5));
    expect(states[0]!.kind).toBe("video");
    expect(states[1]).toMatchObject({ reason: "live_upcoming" });
    // Hybrid: session 2 is later today, so the front door goes there; "recent" stays on session 1.
    expect(entryDecision(rules, list, nobody(), at(2.5))).toEqual({ kind: "day", position: 2 });
    expect(entryDecision({ ...rules, betweenSessions: "recent" }, list, nobody(), at(2.5))).toEqual({ kind: "day", position: 1 });
    expect(computeDayStates(rules, [{ ...list[0]!, hasVideo: false }, list[1]!], nobody(), at(2.5))[0]!.kind).toBe("replay_pending");
  });

  it("an evergreen module before the start stays locked even when another module is a live day", () => {
    // isLive only counts in live mode.
    const states = computeDayStates(funnel(), [day(1, { isLive: true, liveStartAt: at(-5) })], nobody(), at(-1));
    expect(states[0]).toMatchObject({ kind: "locked", reason: "not_started" });
  });
});

describe("between sessions (live front door)", () => {
  // Sessions at 8 pm Eastern on 12 and 13 Oct 2026 (00:00 UTC the next day).
  const s1 = new Date("2026-10-13T00:00:00Z");
  const s2 = new Date("2026-10-14T00:00:00Z");
  const list = [
    day(1, { isLive: true, hasVideo: true, liveStartAt: s1, liveEndAt: new Date(s1.getTime() + 2 * HOUR) }),
    day(2, { isLive: true, hasVideo: false, liveStartAt: s2, liveEndAt: new Date(s2.getTime() + 2 * HOUR) }),
  ];
  const rules = (betweenSessions?: "hybrid" | "recent" | "next") => funnel({ mode: "live", startAt: s1, betweenSessions });
  const lateEvening = new Date("2026-10-13T03:00:00Z"); // 11 pm ET, 12 Oct
  const justAfterMidnight = new Date("2026-10-13T04:30:00Z"); // 12:30 am ET, 13 Oct
  const morningOf = new Date("2026-10-13T14:00:00Z"); // 10 am ET, 13 Oct

  it("hybrid: the most recent session until the calendar day of the next one", () => {
    expect(entryDecision(rules(), list, nobody(), lateEvening)).toEqual({ kind: "day", position: 1 });
    expect(entryDecision(rules(), list, nobody(), justAfterMidnight)).toEqual({ kind: "day", position: 2 });
    expect(entryDecision(rules("hybrid"), list, nobody(), morningOf)).toEqual({ kind: "day", position: 2 });
  });

  it("recent and next", () => {
    expect(entryDecision(rules("recent"), list, nobody(), morningOf)).toEqual({ kind: "day", position: 1 });
    expect(entryDecision(rules("next"), list, nobody(), lateEvening)).toEqual({ kind: "day", position: 2 });
  });

  it("after the last session every rule lands on it", () => {
    const after = new Date("2026-10-15T12:00:00Z");
    for (const rule of ["hybrid", "recent", "next"] as const) expect(entryDecision(rules(rule), list, nobody(), after)).toEqual({ kind: "day", position: 2 });
  });

  it("the calendar day follows the org time zone", () => {
    expect(dayKey(justAfterMidnight, "America/New_York")).toBe("2026-10-13");
    expect(dayKey(justAfterMidnight, "America/Los_Angeles")).toBe("2026-10-12");
    // In Los Angeles it is still the 12th, so hybrid keeps session 1.
    expect(entryDecision({ ...rules(), timeZone: "America/Los_Angeles" }, list, nobody(), justAfterMidnight)).toEqual({ kind: "day", position: 1 });
  });
});

describe("an earlier session blocks a later one's countdown", () => {
  it("until the earlier session is over", () => {
    const rules = funnel({ mode: "live" });
    const d1 = day(1, { isLive: true, liveStartAt: at(10), liveEndAt: at(11) });
    const d2 = day(2, { isLive: true, liveStartAt: at(34), liveEndAt: at(35) });
    expect(earlierPendingSession(rules, [d1, d2], d2, at(9))?.id).toBe("m1");
    expect(earlierPendingSession(rules, [d1, d2], d2, at(10.5))?.id).toBe("m1");
    expect(earlierPendingSession(rules, [d1, d2], d2, at(12))).toBeUndefined();
    expect(earlierPendingSession(rules, [{ ...d1, liveOverride: "off" }, d2], d2, at(9))).toBeUndefined();
  });
});

describe("calendar reminders", () => {
  it("parses '1 day, 2 hours, 15 min, 5' and describes it", async () => {
    const { parseReminders, describeReminders } = await import("./calendar");
    expect(parseReminders("1 day, 2 hours, 15 min, 5")).toEqual([1440, 120, 15, 5]);
    expect(parseReminders("60, 60; 1h, nonsense")).toEqual([60]);
    expect(parseReminders("1,2,3,4,5,6,7")).toHaveLength(5);
    expect(describeReminders([1440, 60, 15])).toBe("1 day, 1 hour, 15 min before");
    expect(describeReminders([])).toBe("no reminders");
  });
});

describe("stats report", () => {
  it("rolls views and clicks up per page, device and button", async () => {
    const { funnelReport } = await import("./stats");
    const t = new Date("2026-10-12T15:00:00Z");
    const report = funnelReport({
      timeZone: "America/New_York",
      pages: [
        { key: "waitlist:", page: "waitlist", id: null, label: "Landing page" },
        { key: "day:m1", page: "day", id: "m1", label: "Day 1" },
      ],
      events: [
        { dayId: null, page: "waitlist", kind: "view", target: null, device: "mobile", visitorId: "a", createdAt: t },
        { dayId: null, page: null, kind: "view", target: null, device: null, visitorId: "b", createdAt: t },
        { dayId: "m1", page: "day", kind: "view", target: null, device: "desktop", visitorId: "a", createdAt: t },
        { dayId: "m1", page: "day", kind: "resource", target: "0|Workbook|https://x.example/w.pdf", device: "desktop", visitorId: "a", createdAt: t },
        { dayId: "m1", page: "day", kind: "cta", target: "Buy", device: "desktop", visitorId: "a", createdAt: t },
      ],
    });
    expect(report.visitors).toBe(2);
    expect(report.pages[0]).toMatchObject({ views: 2, uniques: 2, pctOfUsers: 100 });
    expect(report.pages[1]).toMatchObject({ views: 1, uniques: 1, pctOfUsers: 50, clicks: { resource: 1, cta: 1 } });
    expect(report.clicks.find((row) => row.kind === "resource")).toMatchObject({ target: "Workbook · https://x.example/w.pdf", ctr: 100 });
    expect(report.daily).toEqual([{ date: "2026-10-12", views: 3, uniques: 2 }]);
  });
});

describe("new funnel design", () => {
  it("starts new funnels with the old app's look and leaves the fallback for existing ones unchanged", async () => {
    const { DEFAULT_DESIGN, NEW_FUNNEL_DESIGN, normalizeDesign } = await import("./design");
    const stored = normalizeDesign(JSON.parse(JSON.stringify(NEW_FUNNEL_DESIGN)));
    expect(stored).toEqual(NEW_FUNNEL_DESIGN);
    expect(stored.header).toMatchObject({ logoAlign: "left", logoLink: "none", bg: "#222222" });
    expect(stored.nav.fade).toBe("others");
    // A funnel created before stores {}: it keeps today's computed look.
    expect(normalizeDesign({})).toEqual(DEFAULT_DESIGN);
    expect(DEFAULT_DESIGN.header).toMatchObject({ logoAlign: "center", logoLink: "home" });
    expect(DEFAULT_DESIGN.nav.fade).toBe("locked");
  });
});
