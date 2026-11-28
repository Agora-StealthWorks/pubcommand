/**
 * Docuseries access windows: each episode opens on its schedule and expires
 * accessHours later, per viewer. The front door follows the open episode.
 */
import { describe, expect, it } from "vitest";
import { computeDayStates, entryDecision, type DayRules, type FunnelRules, type ViewerFacts } from "./state";

const HOUR = 3_600_000;
const T0 = new Date("2026-10-12T20:00:00Z");
const at = (hours: number) => new Date(T0.getTime() + hours * HOUR);

const docu = (overrides: Partial<FunnelRules> = {}): FunnelRules => ({
  mode: "evergreen",
  timing: "per_viewer",
  startAt: null,
  endAt: null,
  closeAfterHours: null,
  closeMode: "page",
  progression: "scheduled",
  watchPercent: 80,
  livestreamUrl: null,
  waitlistEnabled: false,
  accessHours: 24,
  ...overrides,
});

const day = (position: number, overrides: Partial<DayRules> = {}): DayRules => ({
  id: `e${position}`,
  position,
  hasVideo: true,
  unlockOffsetHours: (position - 1) * 24,
  unlockAt: null,
  unlockKey: `k${position}`,
  isLive: false,
  liveStartAt: null,
  liveEndAt: null,
  liveUrl: null,
  liveOverride: "auto",
  ...overrides,
});

const episodes = [day(1), day(2), day(3)];
const viewer = (): ViewerFacts => ({ start: T0.getTime(), watched: {}, keys: [] });

describe("episode access windows", () => {
  it("one episode open at a time, each for 24h, then expired", () => {
    const s = computeDayStates(docu(), episodes, viewer(), at(30));
    expect(s[0]).toEqual({ kind: "locked", reason: "expired", unlockAt: null, expiredAt: at(24) });
    expect(s[1]).toEqual({ kind: "video", expiresAt: at(48) });
    expect(s[2]).toEqual({ kind: "locked", reason: "scheduled", unlockAt: at(48) });
  });

  it("the open episode carries its expiry for the countdown", () => {
    expect(computeDayStates(docu(), episodes, viewer(), at(1))[0]).toEqual({ kind: "video", expiresAt: at(24) });
  });

  it("a per-module override wins over the funnel's window", () => {
    const days = [day(1, { accessHours: 72 }), day(2), day(3)];
    expect(computeDayStates(docu(), days, viewer(), at(30))[0]).toEqual({ kind: "video", expiresAt: at(72) });
  });

  it("no window = nothing expires (today's behaviour)", () => {
    expect(computeDayStates(docu({ accessHours: null }), episodes, viewer(), at(200))[0]).toEqual({ kind: "video" });
    expect(computeDayStates(docu({ accessHours: 0 }), episodes, viewer(), at(200))[0]).toEqual({ kind: "video" });
  });

  it("watch % and link-key modules have no fixed open time, so they never expire", () => {
    const s = computeDayStates(docu({ progression: "url_key" }), episodes, { ...viewer(), keys: ["e2"] }, at(100));
    expect(s[0]).toMatchObject({ reason: "expired" });
    expect(s[1]).toEqual({ kind: "video" });
  });

  it("live modules ignore the window", () => {
    const live = docu({ mode: "live", timing: "fixed", startAt: T0 });
    const days = [day(1, { isLive: true, liveStartAt: at(1), liveEndAt: at(2) })];
    expect(computeDayStates(live, days, viewer(), at(100))[0]).toEqual({ kind: "video" });
  });

  it("front door: the open episode, then the next countdown, then closed", () => {
    expect(entryDecision(docu(), episodes, viewer(), at(30))).toEqual({ kind: "day", position: 2 });
    // A gap between episodes (episode 3 opens at +72h).
    const gap = [day(1), day(2), day(3, { unlockOffsetHours: 72 })];
    expect(entryDecision(docu(), gap, viewer(), at(60))).toEqual({ kind: "day", position: 3 });
    expect(entryDecision(docu(), episodes, viewer(), at(80))).toEqual({ kind: "closed" });
  });
});
