import { describe, expect, it } from "vitest";
import { checkFunnel, csvCell, normalizeSlug, parseResources, toCsv, type FunnelCheckInput } from "./checks";
import {
  computeDayStates,
  ctaVisibility,
  effectiveEnd,
  entryDecision,
  fillLockMessage,
  isLiveNow,
  type DayRules,
  type FunnelRules,
  type ViewerFacts,
} from "./state";
import { aggregateFunnel, funnelBrainNote } from "./stats";
import { formatZoned, utcToZonedLocal, zoneOffsetMinutes, zonedDayKey, zonedLocalToUtc } from "./time";
import { decodeViewer, emptyViewerCookie, encodeViewer, ensureStart, normalizeViewer, recordWatch, rememberKey, viewerCookieName, viewerSecret } from "./viewer";
import { embedUrl, fallbackThumbnail, parseVideo, readOembed } from "./video";

const HOUR = 3_600_000;
const T0 = new Date("2026-12-01T17:00:00Z");
const at = (hours: number) => new Date(T0.getTime() + hours * HOUR);
const ids = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003"] as const;

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
    livestreamUrl: "https://room.example.com/live",
    waitlistEnabled: true,
    ...overrides,
  };
}

function day(position: number, overrides: Partial<DayRules> = {}): DayRules {
  return {
    id: ids[position - 1]!,
    position,
    hasVideo: true,
    unlockOffsetHours: (position - 1) * 24,
    unlockAt: null,
    unlockKey: `key${position}`,
    isLive: false,
    liveStartAt: null,
    liveEndAt: null,
    liveUrl: null,
    liveOverride: "auto",
    ...overrides,
  };
}

const viewer = (overrides: Partial<ViewerFacts> = {}): ViewerFacts => ({ watched: {}, keys: [], ...overrides });
const three = [day(1), day(2), day(3)];

describe("state engine precedence", () => {
  it("1. closed wins over everything, including a live session", () => {
    const live = funnel({ mode: "live" });
    const days = [day(1, { isLive: true, liveOverride: "on" })];
    expect(computeDayStates(live, days, viewer(), at(24 * 8))).toEqual([{ kind: "closed" }]);
  });

  it("2. live now beats not-started (a forced-on stream before the start)", () => {
    const live = funnel({ mode: "live" });
    const states = computeDayStates(live, [day(1, { isLive: true, liveOverride: "on", liveUrl: "https://room.example.com/d1" })], viewer(), at(-5));
    expect(states[0]).toEqual({ kind: "live", url: "https://room.example.com/d1" });
  });

  it("2. live now inside the session window, falling back to the funnel room", () => {
    const live = funnel({ mode: "live" });
    const days = [day(1, { isLive: true, liveStartAt: at(1), liveEndAt: at(2) })];
    expect(computeDayStates(live, days, viewer(), at(1.5))[0]).toEqual({ kind: "live", url: "https://room.example.com/live" });
    expect(isLiveNow(live, days[0]!, at(2))).toBe(false);
  });

  it("2. a session with no end runs for the default length", () => {
    const live = funnel({ mode: "live" });
    const d = day(1, { isLive: true, liveStartAt: at(1) });
    expect(isLiveNow(live, d, at(2.9))).toBe(true);
    expect(isLiveNow(live, d, at(3.1))).toBe(false);
  });

  it("3. not started locks every day until the start (day 1 included)", () => {
    const states = computeDayStates(funnel(), three, viewer(), at(-1));
    expect(states.every((state) => state.kind === "locked" && state.reason === "not_started")).toBe(true);
    expect(states[0]).toMatchObject({ unlockAt: T0 });
  });

  it("3. not started shows a scheduled day's own unlock time when later than the start", () => {
    const states = computeDayStates(funnel({ progression: "scheduled" }), three, viewer(), at(-1));
    expect(states[2]).toEqual({ kind: "locked", reason: "not_started", unlockAt: at(48) });
  });

  it("4. live upcoming: a live day before its session", () => {
    const live = funnel({ mode: "live" });
    const states = computeDayStates(live, [day(1, { isLive: true, liveStartAt: at(-2), liveEndAt: at(-1) }), day(2, { isLive: true, liveStartAt: at(24) })], viewer(), at(3));
    expect(states[1]).toEqual({ kind: "locked", reason: "live_upcoming", unlockAt: at(24) });
  });

  it("5. progression lock applies after the start, never to day 1", () => {
    const states = computeDayStates(funnel({ progression: "scheduled" }), three, viewer(), at(1));
    expect(states[0]).toEqual({ kind: "video" });
    expect(states[1]).toEqual({ kind: "locked", reason: "scheduled", unlockAt: at(24) });
  });

  it("5. live days ignore progression", () => {
    const live = funnel({ mode: "live", progression: "url_key" });
    const days = [day(1, { isLive: true, liveStartAt: at(-30), liveEndAt: at(-29) }), day(2, { isLive: true, liveStartAt: at(-5), liveEndAt: at(-4) })];
    expect(computeDayStates(live, days, viewer(), at(1))[1]).toEqual({ kind: "video" });
  });

  it("6. video when open and the video is in", () => {
    expect(computeDayStates(funnel(), three, viewer(), at(1))).toEqual([{ kind: "video" }, { kind: "video" }, { kind: "video" }]);
  });

  it("7. replay pending: live day after the session, no replay yet", () => {
    const live = funnel({ mode: "live" });
    const days = [day(1, { isLive: true, hasVideo: false, liveStartAt: at(1), liveEndAt: at(2) })];
    expect(computeDayStates(live, days, viewer(), at(3))[0]).toEqual({ kind: "replay_pending" });
    expect(computeDayStates(live, [{ ...days[0]!, hasVideo: true }], viewer(), at(3))[0]).toEqual({ kind: "video" });
  });

  it("7. a cancelled (override off) live day is never live", () => {
    const live = funnel({ mode: "live" });
    const days = [day(1, { isLive: true, hasVideo: false, liveStartAt: at(1), liveOverride: "off" })];
    expect(computeDayStates(live, days, viewer(), at(1.5))[0]).toEqual({ kind: "replay_pending" });
  });

  it("8. coming soon: evergreen day with no video", () => {
    expect(computeDayStates(funnel(), [day(1, { hasVideo: false })], viewer(), at(1))[0]).toEqual({ kind: "coming_soon" });
  });

  it("sorts by position whatever the input order", () => {
    const states = computeDayStates(funnel({ progression: "scheduled" }), [day(3), day(1), day(2)], viewer(), at(30));
    expect(states.map((state) => state.kind)).toEqual(["video", "video", "locked"]);
  });
});

describe("progression modes", () => {
  it("all open: every day open after the start", () => {
    expect(computeDayStates(funnel({ progression: "all_open" }), three, viewer(), at(0)).map((s) => s.kind)).toEqual(["video", "video", "video"]);
  });

  it("scheduled (fixed start): offset hours, and an exact time wins", () => {
    const days = [day(1), day(2), day(3, { unlockAt: at(30) })];
    const states = computeDayStates(funnel({ progression: "scheduled" }), days, viewer(), at(29));
    expect(states.map((s) => s.kind)).toEqual(["video", "video", "locked"]);
    expect(states[2]).toMatchObject({ unlockAt: at(30) });
  });

  it("scheduled (per viewer): offsets count from the viewer's first visit", () => {
    const perViewer = funnel({ timing: "per_viewer", startAt: null, endAt: null, progression: "scheduled" });
    const firstVisit = at(100).getTime();
    expect(computeDayStates(perViewer, three, viewer({ start: firstVisit }), at(110))[1]).toMatchObject({ kind: "locked", unlockAt: at(124) });
    expect(computeDayStates(perViewer, three, viewer({ start: firstVisit }), at(125))[1]).toEqual({ kind: "video" });
    // A brand-new viewer starts now: day 1 open, day 2 a day away.
    expect(computeDayStates(perViewer, three, viewer(), at(500)).map((s) => s.kind)).toEqual(["video", "locked", "locked"]);
  });

  it("watch %: day N unlocks once day N-1 is watched past the threshold", () => {
    const watch = funnel({ progression: "watch_percent", watchPercent: 80 });
    expect(computeDayStates(watch, three, viewer({ watched: { [ids[0]]: 79 } }), at(1))[1]).toEqual({ kind: "locked", reason: "watch", unlockAt: null, prevPosition: 1 });
    const states = computeDayStates(watch, three, viewer({ watched: { [ids[0]]: 80 } }), at(1));
    expect(states.map((s) => s.kind)).toEqual(["video", "video", "locked"]);
  });

  it("URL key: a stored key or the key on this request unlocks; a wrong key does not", () => {
    const keyed = funnel({ progression: "url_key" });
    expect(computeDayStates(keyed, three, viewer(), at(1))[1]).toMatchObject({ kind: "locked", reason: "key" });
    expect(computeDayStates(keyed, three, viewer({ keys: [ids[1]] }), at(1))[1]).toEqual({ kind: "video" });
    expect(computeDayStates(keyed, three, viewer(), at(1), { [ids[1]]: "key2" })[1]).toEqual({ kind: "video" });
    expect(computeDayStates(keyed, three, viewer(), at(1), { [ids[1]]: "nope" })[1]).toMatchObject({ kind: "locked" });
    // Day 1 is never key-locked.
    expect(computeDayStates(keyed, three, viewer(), at(1))[0]).toEqual({ kind: "video" });
  });
});

describe("closing and the entry router", () => {
  it("per-viewer funnels close N hours after the viewer's first visit", () => {
    const perViewer = funnel({ timing: "per_viewer", startAt: null, endAt: null, closeAfterHours: 72 });
    expect(effectiveEnd(perViewer, viewer({ start: T0.getTime() }), at(1))).toEqual(at(72));
    expect(computeDayStates(perViewer, three, viewer({ start: T0.getTime() }), at(72))[0]).toEqual({ kind: "closed" });
    expect(effectiveEnd({ ...perViewer, closeMode: "never" }, viewer({ start: T0.getTime() }), at(1))).toBeNull();
  });

  it("closeMode never ignores the end date", () => {
    expect(computeDayStates(funnel({ closeMode: "never" }), three, viewer(), at(24 * 30))[0]).toEqual({ kind: "video" });
  });

  it("before the start: waitlist, or day 1 when the waitlist is off", () => {
    expect(entryDecision(funnel(), three, viewer(), at(-2))).toEqual({ kind: "waitlist", startAt: T0 });
    expect(entryDecision(funnel({ waitlistEnabled: false }), three, viewer(), at(-2))).toEqual({ kind: "day", position: 1 });
  });

  it("closed, evergreen day 1, a running live session, and the latest opened live day", () => {
    expect(entryDecision(funnel(), three, viewer(), at(24 * 8))).toEqual({ kind: "closed" });
    expect(entryDecision(funnel(), three, viewer(), at(50))).toEqual({ kind: "day", position: 1 });
    const live = funnel({ mode: "live" });
    const days = [day(1, { isLive: true, liveStartAt: at(1), liveEndAt: at(2) }), day(2, { isLive: true, liveStartAt: at(25), liveEndAt: at(26) }), day(3, { isLive: true, liveStartAt: at(49) })];
    expect(entryDecision(live, days, viewer(), at(25.5))).toEqual({ kind: "day", position: 2 });
    expect(entryDecision(live, days, viewer(), at(30))).toEqual({ kind: "day", position: 2 });
  });

  it("fills locked-day message tokens", () => {
    expect(fillLockMessage("Watch {percent}% of {prev_day} to unlock {day} ({unlock_date})", { day: "Day 2", prevDay: "Day 1", percent: 80 })).toBe("Watch 80% of Day 1 to unlock Day 2 (soon)");
  });

  it("decides the CTA server-side except for video time", () => {
    const base = { text: "Order", url: "https://example.com/order", at: null };
    expect(ctaVisibility({ ...base, reveal: "none" }, T0)).toBe("hidden");
    expect(ctaVisibility({ ...base, reveal: "always" }, T0)).toBe("shown");
    expect(ctaVisibility({ ...base, reveal: "datetime", at: at(1) }, T0)).toBe("hidden");
    expect(ctaVisibility({ ...base, reveal: "datetime", at: at(1) }, at(2))).toBe("shown");
    expect(ctaVisibility({ ...base, reveal: "video_time" }, T0)).toBe("after_video_time");
    expect(ctaVisibility({ ...base, text: " ", reveal: "always" }, T0)).toBe("hidden");
  });
});

describe("viewer cookie", () => {
  const secret = "test-secret-that-is-long-enough";
  const sample = { ...emptyViewerCookie("abcDEF123_-x"), start: 1_700_000_000_000, watched: { [ids[0]]: 55 }, keys: [ids[1]] };

  it("round-trips a signed value", () => {
    expect(decodeViewer(encodeViewer(sample, secret), secret)).toEqual(sample);
  });

  it("rejects tampering, another secret, garbage and a missing secret", () => {
    const value = encodeViewer(sample, secret);
    const [payload, signature] = value.split(".");
    const forged = Buffer.from(JSON.stringify({ v: "abcDEF123_-x", w: { [ids[0]]: 100 }, k: [ids[1], ids[2]] })).toString("base64url");
    expect(decodeViewer(`${forged}.${signature}`, secret)).toBeNull();
    expect(decodeViewer(`${payload}.${signature}x`, secret)).toBeNull();
    expect(decodeViewer(value, "another-secret-entirely")).toBeNull();
    expect(decodeViewer("not-a-cookie", secret)).toBeNull();
    expect(decodeViewer(`${value}.extra`, secret)).toBeNull();
    expect(decodeViewer(value, null)).toBeNull();
    expect(decodeViewer(undefined, secret)).toBeNull();
  });

  it("normalizes odd payloads (clamps %, drops bad ids)", () => {
    expect(normalizeViewer({ v: "abcDEF123_-x", w: { [ids[0]]: 140, "not-an-id": 50 }, k: ["x", ids[2]], s: -5 })).toEqual({ visitorId: "abcDEF123_-x", start: undefined, watched: { [ids[0]]: 100 }, keys: [ids[2]] });
    expect(normalizeViewer({ v: "short" })).toBeNull();
  });

  it("watched % only goes up, keys and start are kept once", () => {
    const watched = recordWatch(recordWatch(sample, ids[0], 90), ids[0], 40);
    expect(watched.watched[ids[0]]).toBe(90);
    expect(rememberKey(rememberKey(sample, ids[2]), ids[2]).keys).toEqual([ids[1], ids[2]]);
    expect(ensureStart(sample, at(5)).start).toBe(sample.start);
    expect(ensureStart(emptyViewerCookie("abcDEF123_-x"), at(5)).start).toBe(at(5).getTime());
  });

  it("derives a separate key from AUTH_SECRET unless FUNNELS_COOKIE_SECRET is set", () => {
    const derived = viewerSecret({ AUTH_SECRET: "auth-secret-value-123" });
    expect(derived).toBeTruthy();
    expect(derived).not.toBe("auth-secret-value-123");
    expect(viewerSecret({ AUTH_SECRET: "auth-secret-value-123" })).toBe(derived);
    expect(viewerSecret({ FUNNELS_COOKIE_SECRET: "a-dedicated-funnel-secret", AUTH_SECRET: "x" })).toBe("a-dedicated-funnel-secret");
    expect(viewerSecret({})).toBeNull();
    expect(viewerCookieName("8f0e2c1a-1b2c-4d5e-8f90-123456789abc")).toBe("pcf_8f0e2c1a1b2c4d5e8f90");
  });
});

describe("time zones", () => {
  it("converts New York wall clock in winter (EST) and summer (EDT)", () => {
    expect(zonedLocalToUtc("2026-12-01T12:00", "America/New_York")?.toISOString()).toBe("2026-12-01T17:00:00.000Z");
    expect(zonedLocalToUtc("2026-07-01T12:00", "America/New_York")?.toISOString()).toBe("2026-07-01T16:00:00.000Z");
    expect(zonedLocalToUtc("2026-07-01T12:00", "America/Chicago")?.toISOString()).toBe("2026-07-01T17:00:00.000Z");
    expect(zonedLocalToUtc("2026-07-01T12:00", "Europe/London")?.toISOString()).toBe("2026-07-01T11:00:00.000Z");
  });

  it("handles the DST switches", () => {
    // Spring forward 2026-03-08: 02:30 does not exist; it lands just after the gap.
    expect(zonedLocalToUtc("2026-03-08T01:30", "America/New_York")?.toISOString()).toBe("2026-03-08T06:30:00.000Z");
    expect(zonedLocalToUtc("2026-03-08T03:30", "America/New_York")?.toISOString()).toBe("2026-03-08T07:30:00.000Z");
    expect(zonedLocalToUtc("2026-03-08T02:30", "America/New_York")?.getTime()).toBeGreaterThanOrEqual(new Date("2026-03-08T06:30:00Z").getTime());
    // Fall back 2026-11-01: offsets on each side.
    expect(zoneOffsetMinutes(new Date("2026-11-01T05:30:00Z"), "America/New_York")).toBe(-240);
    expect(zoneOffsetMinutes(new Date("2026-11-01T06:30:00Z"), "America/New_York")).toBe(-300);
  });

  it("round-trips UTC to the wall clock for inputs", () => {
    for (const local of ["2026-01-15T09:05", "2026-06-30T23:59", "2026-11-01T00:30", "2026-03-08T04:00"]) {
      expect(utcToZonedLocal(zonedLocalToUtc(local, "America/New_York"), "America/New_York")).toBe(local);
    }
    expect(utcToZonedLocal(null, "America/New_York")).toBe("");
  });

  it("rejects bad input and gives the zoned calendar day", () => {
    expect(zonedLocalToUtc("2026-02-30T10:00", "America/New_York")).toBeNull();
    expect(zonedLocalToUtc("tomorrow", "America/New_York")).toBeNull();
    expect(zonedLocalToUtc("", "America/New_York")).toBeNull();
    expect(zonedDayKey(new Date("2026-12-02T03:00:00Z"), "America/New_York")).toBe("2026-12-01");
    expect(formatZoned(new Date("2026-12-01T17:00:00Z"), "America/New_York")).toBe("Tuesday, December 1 at 12:00 PM EST");
  });
});

describe("videos, checks and exports", () => {
  it("parses Wistia and YouTube links and ids", () => {
    expect(parseVideo("https://youtu.be/dQw4w9WgXcQ")).toEqual({ provider: "youtube", id: "dQw4w9WgXcQ" });
    expect(parseVideo("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5")).toEqual({ provider: "youtube", id: "dQw4w9WgXcQ" });
    expect(parseVideo("https://www.youtube.com/embed/dQw4w9WgXcQ")).toEqual({ provider: "youtube", id: "dQw4w9WgXcQ" });
    expect(parseVideo("https://acme.wistia.com/medias/abc123defg")).toEqual({ provider: "wistia", id: "abc123defg" });
    expect(parseVideo("https://fast.wistia.net/embed/iframe/abc123defg?videoFoam=true")).toEqual({ provider: "wistia", id: "abc123defg" });
    expect(parseVideo("abc123defg")).toEqual({ provider: "wistia", id: "abc123defg" });
    expect(parseVideo("https://vimeo.com/123")).toBeNull();
    expect(embedUrl({ provider: "youtube", id: "dQw4w9WgXcQ" })).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(fallbackThumbnail({ provider: "wistia", id: "abc123defg" })).toBeNull();
    expect(readOembed({ title: "T", thumbnail_url: "http://insecure", duration: 61.4 })).toEqual({ title: "T", thumbnailUrl: null, durationSeconds: 61 });
  });

  it("blocks publishing on errors", () => {
    const input: FunnelCheckInput = {
      name: "Launch",
      slug: "launch",
      mode: "live",
      timing: "fixed",
      startAt: null,
      endAt: null,
      closeAfterHours: null,
      closeMode: "redirect",
      closeRedirectUrl: null,
      progression: "url_key",
      buildMode: "prebuilt",
      livestreamUrl: null,
      privacyUrl: null,
      optinMode: "form",
      optinFormSlug: null,
      days: [
        { position: 1, title: "One", videoProvider: null, videoId: null, isLive: false, liveStartAt: null, liveUrl: null, unlockKey: "a" },
        { position: 2, title: "", videoProvider: null, videoId: null, isLive: true, liveStartAt: null, liveUrl: null, unlockKey: "b" },
      ],
    };
    const { errors } = checkFunnel(input);
    expect(errors).toEqual(
      expect.arrayContaining([
        "Set the start date and time.",
        "Closing by redirect needs a web address to send people to.",
        expect.stringContaining("privacy-policy"),
        expect.stringContaining("Pick the form"),
        "One: add its video (pre-built funnels need every video before publishing).",
        "Day 2: set the live session's start time.",
      ]),
    );
    const ok = checkFunnel({ ...input, mode: "evergreen", startAt: T0, endAt: at(5), closeMode: "page", privacyUrl: "https://x.example/privacy", optinMode: "none", buildMode: "as_you_go", days: [input.days[0]!] });
    expect(ok.errors).toEqual([]);
  });

  it("neutralizes spreadsheet formulas but keeps phone numbers", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
    expect(csvCell("+12125550142")).toBe(`"+12125550142"`);
    expect(csvCell('say "hi"')).toBe(`"say ""hi"""`);
    expect(toCsv(["a"], [["b"]])).toBe(`"a"\r\n"b"\r\n`);
    expect(normalizeSlug("  Spring Launch: Day ’1’! ")).toBe("spring-launch-day-1");
    expect(parseResources("Workbook | https://x.example/w.pdf\nbad line\nhttps://x.example/2")).toEqual([
      { label: "Workbook", url: "https://x.example/w.pdf" },
      { label: "https://x.example/2", url: "https://x.example/2" },
    ]);
  });
});

describe("aggregates and Brain notes", () => {
  it("rolls events up per day without personal data", () => {
    const stats = aggregateFunnel({
      dayIds: [ids[0], ids[1]],
      events: [
        { dayId: null, kind: "view", visitorId: "a" },
        { dayId: ids[0], kind: "view", visitorId: "a" },
        { dayId: ids[0], kind: "view", visitorId: "b" },
        { dayId: ids[0], kind: "view", visitorId: "a" },
        { dayId: ids[1], kind: "view", visitorId: "a" },
        { dayId: ids[1], kind: "cta", visitorId: "a" },
      ],
      watches: [
        { dayId: ids[0], percent: 100 },
        { dayId: ids[0], percent: 50 },
      ],
      optins: 3,
      completeAt: 80,
    });
    expect(stats).toMatchObject({ waitlistViews: 1, visitors: 2, optins: 3, ctaClicks: 1 });
    expect(stats.days[0]).toEqual({ dayId: ids[0], views: 3, viewers: 2, avgWatch: 75, completed: 1, ctaClicks: 0 });
    const note = funnelBrainNote({ name: "Spring", brandName: "Gazette", mode: "evergreen", progression: "watch_percent", startLabel: null, days: [{ position: 1, title: "Intro", topics: ["Why"], isLive: false }, { position: 2, title: "Deep dive", topics: [], isLive: false }], stats });
    expect(note.body).toContain("Day 1: 2 viewers, average watched 75%");
    expect(note.body).not.toMatch(/@|visitorId/);
  });
});
