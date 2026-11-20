import { describe, expect, it } from "vitest";
import {
  BLOCK_TYPES,
  blockBandStyle,
  duplicateBlock,
  MAX_BLOCKS,
  moveBlockBy,
  moveBlockTo,
  newBlock,
  normalizeBlock,
  normalizeBlocks,
  normalizeTarget,
  removeBlock,
  starterBlocks,
  updateBlock,
  type Block,
} from "./blocks";
import { eventBoxEvent, foldLine, googleCalendarUrl, icsEscape, icsFile, liveSessionEvent, type CalendarEvent } from "./calendar";
import { checkFunnel, type FunnelCheckInput } from "./checks";
import { deadlineBar, deadlineBarVisible, deadlineText, type DeadlineBarConfig } from "./deadline";
import { cssUrl, DEFAULT_DESIGN, designAssetIds, designCss, fontHref, normalizeDesign, remapDesignAssets } from "./design";
import { agendaSequence, moveItem, navSequence, navStrip } from "./nav";
import { entryDecision, type DayRules, type FunnelRules } from "./state";

const HOUR = 3_600_000;
const T0 = new Date("2026-12-01T17:00:00Z");
const at = (hours: number) => new Date(T0.getTime() + hours * HOUR);
const seq = () => {
  let n = 0;
  return () => `bid${String(++n).padStart(5, "0")}`;
};

function funnel(overrides: Partial<FunnelRules> = {}): FunnelRules {
  return { mode: "evergreen", timing: "fixed", startAt: T0, endAt: at(72), closeAfterHours: null, closeMode: "page", progression: "all_open", watchPercent: 80, livestreamUrl: null, waitlistEnabled: true, ...overrides };
}

function day(position: number, overrides: Partial<DayRules> = {}): DayRules {
  return { id: `d${position}`, position, hasVideo: true, unlockOffsetHours: 0, unlockAt: null, unlockKey: "k", isLive: false, liveStartAt: null, liveEndAt: null, liveUrl: null, liveOverride: "auto", ...overrides };
}

describe("home page blocks", () => {
  it("creates every type with its defaults and style", () => {
    for (const type of BLOCK_TYPES) {
      const block = newBlock(type, "babcdef12");
      expect(block.type).toBe(type);
      expect(block.id).toBe("babcdef12");
      expect(block.style.padding).toBeDefined();
      expect(normalizeBlock(block)).toEqual(block);
    }
    expect(newBlock("headline").style.align).toBe("center");
    expect(newBlock("text").style.align).toBe("left");
  });

  it("fills defaults for missing fields and drops unknown ones", () => {
    const block = normalizeBlock({ id: "babcdef12", type: "event", sneaky: "<script>", title: "Big day" }) as Extract<Block, { type: "event" }>;
    expect(block.title).toBe("Big day");
    expect(block.minutes).toBe(60);
    expect(block.countdown).toBe(true);
    expect("sneaky" in block).toBe(false);
  });

  it("rejects unknown types and non-objects", () => {
    expect(normalizeBlock({ type: "script" })).toBeNull();
    expect(normalizeBlock("headline")).toBeNull();
    expect(normalizeBlocks("nope")).toEqual([]);
    expect(normalizeBlocks([null, { type: "divider" }, { type: "bogus" }])).toHaveLength(1);
  });

  it("validates colours, enums, numbers, links and ids", () => {
    const block = normalizeBlock({
      id: "not an id!",
      type: "image",
      style: { bg: "red;background:url(x)", text: "#ABCDEF", padding: "huge", width: "full", align: "right" },
      src: "javascript:alert(1)",
      href: "javascript:alert(1)",
      widthPercent: 500,
      assetId: "../../etc",
    }) as Extract<Block, { type: "image" }>;
    expect(block.id).toMatch(/^b[a-z0-9]{8}$/);
    expect(block.style).toEqual({ bg: null, text: "#abcdef", padding: "medium", width: "full", align: "right" });
    expect(block.src).toBe("");
    expect(block.href).toBe("");
    expect(block.widthPercent).toBe(100);
    expect(block.assetId).toBe("");
    // An explicit empty colour clears a type default (event boxes default to a dark band).
    expect((normalizeBlock({ type: "event", style: { bg: "" } }) as Block).style.bg).toBeNull();
    expect((normalizeBlock({ type: "event" }) as Block).style.bg).toBe("#111827");
  });

  it("accepts only safe button targets", () => {
    expect(normalizeTarget("module:2")).toBe("module:2");
    expect(normalizeTarget("page:bonus-guide")).toBe("page:bonus-guide");
    expect(normalizeTarget("https://example.com/x")).toBe("https://example.com/x");
    expect(normalizeTarget("javascript:alert(1)")).toBe("");
    expect(normalizeTarget("page:../x")).toBe("");
    expect(normalizeTarget("module:abc")).toBe("");
  });

  it("runs the sanitizer over Text blocks only, and caps sizes", () => {
    const sanitize = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, "");
    const [text, html] = normalizeBlocks(
      [
        { type: "text", html: "<p>Hi</p><script>x</script>" },
        { type: "html", html: "<script>ok in a sandbox</script>" + "x".repeat(200_000) },
      ],
      { sanitizeRich: sanitize },
    ) as [Extract<Block, { type: "text" }>, Extract<Block, { type: "html" }>];
    expect(text.html).toBe("<p>Hi</p>");
    expect(html.html.startsWith("<script>ok in a sandbox</script>")).toBe(true);
    expect(html.html.length).toBe(100_000);
  });

  it("replaces duplicate ids and caps the count", () => {
    const blocks = normalizeBlocks([
      { id: "bsame0001", type: "divider" },
      { id: "bsame0001", type: "divider" },
    ]);
    expect(new Set(blocks.map((block) => block.id)).size).toBe(2);
    expect(normalizeBlocks(Array.from({ length: 80 }, () => ({ type: "divider" })))).toHaveLength(MAX_BLOCKS);
  });

  it("reorders, duplicates, updates and removes", () => {
    const make = seq();
    const blocks = ["headline", "text", "agenda"].map((type) => newBlock(type as "headline", make()));
    const [a, b, c] = blocks.map((block) => block.id) as [string, string, string];
    expect(moveBlockBy(blocks, a, 1).map((x) => x.id)).toEqual([b, a, c]);
    expect(moveBlockBy(blocks, a, -1).map((x) => x.id)).toEqual([a, b, c]);
    expect(moveBlockBy(blocks, c, 1).map((x) => x.id)).toEqual([a, b, c]);
    expect(moveBlockTo(blocks, c, 0).map((x) => x.id)).toEqual([c, a, b]);
    expect(moveBlockTo(blocks, a, 99).map((x) => x.id)).toEqual([b, c, a]);
    expect(moveBlockTo(blocks, "bmissing1", 0).map((x) => x.id)).toEqual([a, b, c]);
    const copied = duplicateBlock(blocks, b, "bcopy0001");
    expect(copied.map((x) => x.id)).toEqual([a, b, "bcopy0001", c]);
    expect(copied[2]).toEqual({ ...blocks[1], id: "bcopy0001" });
    copied[2]!.style.bg = "#000000";
    expect(blocks[1]!.style.bg).toBeNull();
    expect(removeBlock(blocks, b).map((x) => x.id)).toEqual([a, c]);
    const updated = updateBlock(blocks, a, { heading: "Hello", type: "divider", id: "bhack0001" });
    expect(updated[0]).toMatchObject({ id: a, type: "headline", heading: "Hello" });
  });

  it("has a starter layout that is already valid", () => {
    const blocks = starterBlocks("Spring <Summit>", seq());
    expect(blocks.map((block) => block.type)).toEqual(["headline", "text", "event", "agenda", "optin", "hosts"]);
    expect(normalizeBlocks(blocks)).toEqual(blocks);
    expect((blocks[1] as Extract<Block, { type: "text" }>).html).toContain("Spring &lt;Summit&gt;");
  });

  it("turns a style into a safe inline style", () => {
    expect(blockBandStyle({ bg: "#112233", text: null, padding: "large", width: "wide", align: "center" })).toEqual({ background: "#112233", paddingTop: 56, paddingBottom: 56, textAlign: "center" });
    expect(blockBandStyle({ bg: "red; x" as string, text: "#fff" as string, padding: "none", width: "full", align: "left" })).toEqual({ paddingTop: 0, paddingBottom: 0, textAlign: "left" });
  });
});

describe("microsite front door", () => {
  it("sends a microsite to its home page until it closes", () => {
    const microsite = funnel({ siteType: "microsite" });
    expect(entryDecision(microsite, [day(1)], { watched: {}, keys: [] }, at(-5))).toEqual({ kind: "home" });
    expect(entryDecision(microsite, [day(1)], { watched: {}, keys: [] }, at(5))).toEqual({ kind: "home" });
    expect(entryDecision(microsite, [], { watched: {}, keys: [] }, at(5))).toEqual({ kind: "home" });
    expect(entryDecision(microsite, [day(1)], { watched: {}, keys: [] }, at(80))).toEqual({ kind: "closed" });
    // A launch funnel still shows the waitlist before the start.
    expect(entryDecision(funnel(), [day(1)], { watched: {}, keys: [] }, at(-5)).kind).toBe("waitlist");
  });
});

describe("deadline bar", () => {
  const bar = (overrides: Partial<DeadlineBarConfig> = {}): DeadlineBarConfig => ({ enabled: true, target: "end", at: null, withinHours: 0, ...overrides });
  const viewer = { watched: {}, keys: [] };

  it("counts down to the close, the start, or a set time", () => {
    expect(deadlineBar(funnel(), bar(), viewer, at(1))).toEqual({ at: at(72), revealAt: null });
    expect(deadlineBar(funnel(), bar({ target: "start" }), viewer, at(-3))).toEqual({ at: T0, revealAt: null });
    expect(deadlineBar(funnel(), bar({ target: "custom", at: at(10) }), viewer, at(1))).toEqual({ at: at(10), revealAt: null });
  });

  it("does not show when off, without a date, or once it has passed", () => {
    expect(deadlineBar(funnel(), bar({ enabled: false }), viewer, at(1))).toBeNull();
    expect(deadlineBar(funnel({ endAt: null }), bar(), viewer, at(1))).toBeNull();
    expect(deadlineBar(funnel(), bar({ target: "custom" }), viewer, at(1))).toBeNull();
    expect(deadlineBar(funnel(), bar({ target: "start" }), viewer, at(1))).toBeNull();
    expect(deadlineBar(funnel(), bar(), viewer, at(72))).toBeNull();
    expect(deadlineBar(funnel({ closeMode: "never" }), bar(), viewer, at(1))).toBeNull();
  });

  it("shows only in the last N hours", () => {
    const timing = deadlineBar(funnel(), bar({ withinHours: 24 }), viewer, at(10));
    expect(timing).toEqual({ at: at(72), revealAt: at(48) });
    expect(deadlineBarVisible(timing, at(10))).toBe(false);
    expect(deadlineBarVisible(timing, at(48))).toBe(true);
    expect(deadlineBarVisible(timing, at(72))).toBe(false);
    // Already inside the window: shows now.
    const inside = deadlineBar(funnel(), bar({ withinHours: 24 }), viewer, at(60));
    expect(inside).toEqual({ at: at(72), revealAt: null });
    expect(deadlineBarVisible(inside, at(60))).toBe(true);
  });

  it("is per viewer on a per-viewer evergreen funnel", () => {
    const perViewer = funnel({ timing: "per_viewer", startAt: null, endAt: null, closeAfterHours: 48 });
    const first = T0.getTime();
    expect(deadlineBar(perViewer, bar(), { watched: {}, keys: [], start: first }, at(5))).toEqual({ at: at(48), revealAt: null });
    expect(deadlineBar(perViewer, bar(), { watched: {}, keys: [], start: at(20).getTime() }, at(25))).toEqual({ at: at(68), revealAt: null });
    // A brand-new viewer's clock starts now.
    expect(deadlineBar(perViewer, bar({ withinHours: 6 }), viewer, at(0))).toEqual({ at: at(48), revealAt: at(42) });
    // Live funnels share one clock even when set to per viewer.
    expect(deadlineBar({ ...perViewer, mode: "live", endAt: at(30) }, bar(), { watched: {}, keys: [], start: first }, at(5))?.at).toEqual(at(30));
  });

  it("fills {date} and {short_date} in the org time zone", () => {
    const text = deadlineText("Ends {date} ({short_date})", new Date("2026-11-12T04:30:00Z"), "America/New_York");
    expect(text).toBe("Ends Wednesday, November 11 at 11:30 PM EST (11/11/2026)");
    expect(deadlineText("{short_date}", new Date("2026-11-12T04:30:00Z"), "Europe/London")).toBe("11/12/2026");
  });
});

describe("add to calendar", () => {
  const event: CalendarEvent = {
    uid: "funnel-1-day-2",
    title: "Spring Summit: Day 2, the Q&A",
    description: "Line one\nLine two; with, punctuation \\ done",
    start: new Date("2026-11-03T20:00:00Z"),
    end: new Date("2026-11-03T21:30:00Z"),
    location: "https://room.example/live",
    url: "https://room.example/live",
    reminders: [1440, 15],
  };

  it("writes a valid .ics with escaped text, UTC times and the org zone", () => {
    const ics = icsFile([event], { timeZone: "America/Chicago", calendarName: "Spring Summit", stamp: new Date("2026-11-01T00:00:00Z"), domain: "acme.example" });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("X-WR-TIMEZONE:America/Chicago");
    expect(ics).toContain("UID:funnel-1-day-2@acme.example");
    expect(ics).toContain("DTSTAMP:20261101T000000Z");
    expect(ics).toContain("DTSTART:20261103T200000Z");
    expect(ics).toContain("DTEND:20261103T213000Z");
    expect(ics).toContain("SUMMARY:Spring Summit: Day 2\\, the Q&A");
    expect(ics).toContain("DESCRIPTION:Line one\\nLine two\\; with\\, punctuation \\\\ done");
    expect(ics).toContain("TRIGGER:-PT1440M");
    expect(ics).toContain("TRIGGER:-PT15M");
    expect(ics.split("\r\n").every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/\n/);
  });

  it("falls back to a safe zone and never lets a newline break a property", () => {
    const ics = icsFile([{ ...event, title: "A\r\nBEGIN:VEVENT", location: "x\ny" }], { timeZone: "Not/AZone" });
    expect(ics).toContain("X-WR-TIMEZONE:America/New_York");
    expect(ics.split("\r\n").filter((line) => line === "BEGIN:VEVENT")).toHaveLength(1);
    expect(icsEscape("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
  });

  it("folds long lines at 75 octets without splitting characters", () => {
    const long = `DESCRIPTION:${"é".repeat(100)}`;
    const folded = foldLine(long).split("\r\n");
    expect(folded.length).toBeGreaterThan(1);
    expect(folded.every((part) => new TextEncoder().encode(part).length <= 75)).toBe(true);
    expect(folded.slice(1).every((part) => part.startsWith(" "))).toBe(true);
    expect(folded.map((part, index) => (index ? part.slice(1) : part)).join("")).toBe(long);
    expect(foldLine("short")).toBe("short");
  });

  it("builds a Google Calendar link in the org zone", () => {
    const url = new URL(googleCalendarUrl(event, "America/Chicago"));
    expect(url.origin).toBe("https://calendar.google.com");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("dates")).toBe("20261103T200000Z/20261103T213000Z");
    expect(url.searchParams.get("ctz")).toBe("America/Chicago");
    expect(url.searchParams.get("text")).toBe(event.title);
  });

  it("makes invites for live sessions and event boxes", () => {
    const live = liveSessionEvent({
      funnelId: "f1",
      funnelName: "Summit",
      day: { id: "d2", label: "Day 2", title: "Q&A", topics: ["Topic A"], liveStartAt: new Date("2026-11-03T20:00:00Z"), liveEndAt: null, liveUrl: null },
      roomUrl: "https://room.example",
      pageUrl: "https://acme.example/l/summit/day-2",
      timeZone: "America/New_York",
    })!;
    expect(live.title).toBe("Summit: Q&A");
    expect(live.end.getTime() - live.start.getTime()).toBe(3 * HOUR);
    expect(live.location).toBe("https://room.example");
    expect(live.description).toContain("Tuesday, November 3 at 3:00 PM EST");
    expect(live.description).toContain("Join the livestream here:\nhttps://room.example");
    expect(live.reminders).toEqual([1440, 60, 15]);
    const custom = liveSessionEvent({
      funnelId: "f1",
      funnelName: "Summit",
      day: { id: "d2", label: "Day 2", title: "Q&A", topics: ["Topic A"], liveStartAt: new Date("2026-11-03T20:00:00Z"), liveEndAt: null, liveUrl: "https://own.example" },
      roomUrl: "https://room.example",
      pageUrl: "https://acme.example/l/summit/day-2",
      timeZone: "America/New_York",
      invite: { titleTemplate: "{day} · {funnel}", descTemplate: "{topics}\n{time}\n{page_url}\n{agenda}", reminders: [30], agenda: [{ label: "Day 2", title: "Q&A", topics: ["Topic A"], liveStartAt: new Date("2026-11-03T20:00:00Z") }] },
    })!;
    expect(custom.title).toBe("Day 2 · Summit");
    expect(custom.location).toBe("https://own.example");
    expect(custom.description).toContain("• Topic A");
    expect(custom.description).toContain("3:00 PM EST");
    expect(custom.description).toContain("https://acme.example/l/summit/day-2");
    expect(custom.description).toContain("• Day 2: Q&A — Tuesday, November 3 at 3:00 PM EST\n   – Topic A");
    expect(custom.reminders).toEqual([30]);
    expect(liveSessionEvent({ funnelId: "f1", funnelName: "S", day: { id: "d", label: "Day 1", title: "", topics: [], liveStartAt: null, liveEndAt: null, liveUrl: null }, roomUrl: null, pageUrl: "https://x", timeZone: "UTC" })).toBeNull();
    const box = eventBoxEvent({ funnelId: "f1", blockId: "b1", title: "Summit", start: new Date("2026-11-03T20:00:00Z"), minutes: 90, pageUrl: "https://acme.example/l/summit", timeZone: "America/New_York" })!;
    expect(box.end.getTime() - box.start.getTime()).toBe(90 * 60_000);
    expect(eventBoxEvent({ funnelId: "f1", blockId: "b1", title: "S", start: null, minutes: 60, pageUrl: "https://x", timeZone: "UTC" })).toBeNull();
  });
});

describe("navigation order", () => {
  const days = ["D1", "D2", "D3"];
  const item = (id: string, afterModule: number | null, sort = 0, extra: Partial<{ showInNav: boolean; kind: string; showInAgenda: boolean }> = {}) => ({ id, afterModule, sort, showInNav: true, kind: "page", showInAgenda: false, ...extra });
  const labels = (entries: ReturnType<typeof navSequence<string, ReturnType<typeof item>>>) => entries.map((entry) => (entry.kind === "day" ? entry.day : entry.item.id));

  it("places items before, between and after modules", () => {
    expect(labels(navSequence(days, [item("end", null), item("first", 0), item("after2", 2), item("after1", 1)]))).toEqual(["first", "D1", "after1", "D2", "after2", "D3", "end"]);
  });

  it("puts out-of-range positions at the end and keeps sort, then list order", () => {
    expect(labels(navSequence(days, [item("late", 99), item("b", 1, 2), item("a", 1, 1), item("c", 1, 2)]))).toEqual(["D1", "a", "b", "c", "D2", "D3", "late"]);
    expect(labels(navSequence([], [item("x", 3), item("y", 0)]))).toEqual(["x", "y"]);
    expect(labels(navSequence(days, [item("neg", -4)]))).toEqual(["neg", "D1", "D2", "D3"]);
  });

  it("keeps the module index for each day", () => {
    const entries = navSequence(days, [item("x", 1)]);
    expect(entries.filter((entry) => entry.kind === "day").map((entry) => (entry.kind === "day" ? entry.index : -1))).toEqual([0, 1, 2]);
  });

  it("filters the strip and the agenda", () => {
    const items = [item("hidden", 1, 0, { showInNav: false }), item("ph", 2, 0, { kind: "placeholder", showInAgenda: true }), item("page", 0, 0, { showInAgenda: true })];
    expect(labels(navStrip(days, items))).toEqual(["page", "D1", "D2", "ph", "D3"]);
    expect(labels(agendaSequence(days, items))).toEqual(["D1", "D2", "ph", "D3"]);
  });

  it("moves an item up or down", () => {
    expect(moveItem(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
    expect(moveItem(["a"], "z", 1)).toEqual(["a"]);
  });
});

describe("design tokens and CSS", () => {
  it("fills every value from defaults and the legacy columns", () => {
    expect(normalizeDesign({})).toEqual(DEFAULT_DESIGN);
    const legacy = normalizeDesign(null, { headerBg: "#222222", pageBg: "#FAFAFA", textColor: "#333333", accentColor: "#ff6600", logoHeight: 55 });
    expect(legacy.header.bg).toBe("#222222");
    expect(legacy.page).toMatchObject({ bg: "#fafafa", text: "#333333", accent: "#ff6600" });
    expect(legacy.header.logoHeight).toBe(55);
    // The design JSON wins over the legacy columns.
    expect(normalizeDesign({ header: { bg: "#000000" } }, { headerBg: "#222222" }).header.bg).toBe("#000000");
  });

  it("validates every colour, clamps numbers and refuses unknown choices", () => {
    const design = normalizeDesign({
      header: { bg: "red", bg2: "#12345", gradientDir: "to left; color:red", dim: 400, paddingY: -5, logoHeight: 9999, logoAlign: "middle", imageUrl: "http://insecure.example/x.png", logoLinkUrl: "javascript:alert(1)" },
      page: { bg: "#GGGGGG", text: "#ffffff", accent: "expression(alert(1))", buttonText: "", buttonRadius: "12", font: "comic-sans" },
      content: { text: "#abc", link: "#00AA00", borderWidth: 99 },
      nav: { thumbWidth: 10, fade: "everything" },
      footer: { links: [{ label: "Help", url: "https://help.example" }, { label: "Bad", url: "javascript:x" }, { label: "", url: "https://x.example" }], logoHeight: "" },
    });
    expect(design.header).toMatchObject({ bg: "#111827", bg2: null, gradientDir: "to right", dim: 100, paddingY: 0, logoHeight: 240, logoAlign: "center", imageUrl: null, logoLinkUrl: null });
    expect(design.page).toMatchObject({ bg: "#f5f6f8", text: "#ffffff", accent: "#1d4ed8", buttonText: null, buttonRadius: 12, font: "system" });
    expect(design.content).toMatchObject({ text: null, link: "#00aa00", borderWidth: 8 });
    expect(design.nav).toMatchObject({ thumbWidth: 80, fade: "locked" });
    expect(design.footer.links).toEqual([{ label: "Help", url: "https://help.example" }]);
    expect(design.footer.logoHeight).toBeNull();
  });

  it("generates CSS from the tokens", () => {
    const css = designCss(
      normalizeDesign({ header: { bg: "#000000", bg2: "#333333", gradientDir: "135deg", width: "wide", logoAlign: "left", logoHeight: 60, logoHeightMobile: 32 }, page: { accent: "#ff0000", buttonStyle: "outline", font: "inter" }, content: { bg: "#fefefe", radius: 4 } }),
    );
    expect(css).toContain("linear-gradient(135deg,#000000,#333333)");
    expect(css).toContain("max-width:1280px");
    expect(css).toContain("justify-content:flex-start");
    expect(css).toContain("max-height:60px");
    expect(css).toContain("max-height:32px");
    expect(css).toContain("--pcf-accent:#ff0000");
    expect(css).toContain("background:transparent;color:var(--pcf-accent)");
    expect(css).toContain('"Inter"');
    expect(css).toContain("border-radius:4px");
  });

  it("puts the header image under a dimmed overlay", () => {
    const css = designCss(normalizeDesign({ header: { bg: "#000000", dim: 50, imageFit: "tile", imagePos: "top" } }), { header: "/l/x/asset/00000000-0000-4000-8000-000000000001?v=1" });
    expect(css).toContain('url("/l/x/asset/00000000-0000-4000-8000-000000000001?v=1")');
    expect(css).toContain("rgba(0,0,0,0.50)");
    expect(css).toContain("background-repeat:repeat");
    expect(css).toContain("background-position:top");
  });

  it("cannot be made to inject CSS or markup", () => {
    const evil = "#fff;}</style><script>alert(1)</script><style>";
    const css = designCss(
      { header: { bg: evil, bg2: evil, gradientDir: evil, imageFit: evil, imagePos: evil, width: evil, logoAlign: evil }, page: { bg: evil, text: evil, accent: evil, font: evil, buttonStyle: evil }, content: { bg: evil, border: evil, link: evil }, nav: { bg: evil, thumbStyle: evil, activeStyle: evil }, footer: { bg: evil, text: evil } },
      { header: 'x.png") ; } body{display:none} ("', page: "https://ok.example/a.png\"onerror" },
    );
    expect(css).not.toMatch(/[<>]/);
    expect(css).not.toContain("script");
    expect(css).not.toContain("display:none");
    expect(css).not.toContain("onerror");
    // Every rule opens and closes cleanly.
    expect(css.split("{").length).toBe(css.split("}").length);
  });

  it("accepts only safe image URLs in CSS", () => {
    expect(cssUrl("/l/launch/asset/abc?v=2")).toBe("/l/launch/asset/abc?v=2");
    expect(cssUrl("https://cdn.example/a.png")).toBe("https://cdn.example/a.png");
    expect(cssUrl("http://cdn.example/a.png")).toBeNull();
    expect(cssUrl("//evil.example/a.png")).toBeNull();
    expect(cssUrl('https://cdn.example/a.png")')).toBeNull();
    expect(cssUrl("https://cdn.example/a b.png")).toBeNull();
    expect(cssUrl("javascript:alert(1)")).toBeNull();
    expect(cssUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(cssUrl(null)).toBeNull();
  });

  it("loads a Google Font only when one is used", () => {
    expect(fontHref(normalizeDesign({ page: { font: "system" } }))).toBeNull();
    expect(fontHref(normalizeDesign({ page: { font: "serif" } }))).toBeNull();
    expect(fontHref(normalizeDesign({ page: { font: "montserrat" } }))).toBe("https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap");
  });

  it("lists and remaps the design's own images", () => {
    const id1 = "00000000-0000-4000-8000-000000000001";
    const id2 = "00000000-0000-4000-8000-000000000002";
    const design = normalizeDesign({ header: { imageAssetId: id1 }, footer: { logoAssetId: id2 } });
    expect(designAssetIds(design)).toEqual([id1, id2]);
    const moved = remapDesignAssets(design, (id) => (id === id1 ? id2 : null));
    expect(moved.header.imageAssetId).toBe(id2);
    expect(moved.footer.logoAssetId).toBeNull();
  });
});

describe("microsite publish checks", () => {
  const base: FunnelCheckInput = {
    name: "Site",
    slug: "site",
    mode: "evergreen",
    timing: "fixed",
    startAt: T0,
    endAt: at(10),
    closeAfterHours: null,
    closeMode: "page",
    closeRedirectUrl: null,
    progression: "all_open",
    buildMode: "as_you_go",
    livestreamUrl: null,
    privacyUrl: "https://x.example/privacy",
    optinMode: "none",
    optinFormSlug: null,
    days: [],
  };

  it("lets a microsite publish without modules but warns about an empty home page", () => {
    const empty = checkFunnel({ ...base, siteType: "microsite", homeBlockCount: 0 });
    expect(empty.errors).toEqual([]);
    expect(empty.warnings.join(" ")).toContain("home page has no blocks");
    expect(checkFunnel({ ...base, siteType: "microsite", homeBlockCount: 3 }).warnings.join(" ")).not.toContain("no blocks");
    expect(checkFunnel(base).errors).toContain("Add at least one day.");
  });

  it("checks pages, links and the deadline bar", () => {
    const result = checkFunnel({
      ...base,
      siteType: "microsite",
      homeBlockCount: 1,
      navItems: [
        { kind: "page", label: "Bonus", title: "", slug: "bonus", url: "", optinMode: "none", optinFormSlug: null },
        { kind: "page", label: "Again", title: "", slug: "bonus", url: "", optinMode: "form", optinFormSlug: null },
        { kind: "page", label: "", title: "", slug: "", url: "", optinMode: "none", optinFormSlug: null },
        { kind: "link", label: "Shop", title: "", slug: "", url: "nope", optinMode: "none", optinFormSlug: null },
        { kind: "placeholder", label: "Soon", title: "", slug: "", url: "", optinMode: "none", optinFormSlug: null },
      ],
      deadlineBar: { enabled: true, target: "custom", at: null },
    });
    expect(result.errors).toEqual([
      "Two pages share the link name “bonus”.",
      "Again: pick the form to show under the page, or switch its opt-in off.",
      "A page: give the page a link name (lowercase letters, numbers and dashes).",
      "Shop: the link needs a web address (https://…).",
      "The deadline bar counts down to a set time, but no time is set.",
    ]);
    expect(checkFunnel({ ...base, endAt: null, siteType: "microsite", homeBlockCount: 1, deadlineBar: { enabled: true, target: "end", at: null } }).warnings.join(" ")).toContain("never shows");
  });
});

describe("microsite brain note", () => {
  it("names the type and lists home sections and pages", async () => {
    const { funnelBrainNote } = await import("./stats");
    const note = funnelBrainNote({
      name: "Summit",
      brandName: "Gazette",
      mode: "evergreen",
      progression: "all_open",
      startLabel: null,
      days: [{ position: 1, title: "Intro", topics: [], isLive: false }],
      stats: { visitors: 0, waitlistViews: 0, optins: 0, ctaClicks: 0, days: [] },
      siteType: "microsite",
      homeSections: ["Headline", "Agenda"],
      pages: ["Bonus guide"],
    });
    expect(note.title).toBe("Microsite: Summit");
    expect(note.body).toContain("Home page sections: Headline, Agenda.");
    expect(note.body).toContain("Extra pages: Bonus guide.");
  });
});
