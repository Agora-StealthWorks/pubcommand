import { describe, expect, it } from "vitest";
import { bucketOf, niceTicks, rollup, toSendRow, totals, type SendRow } from "./analytics";
import { averageScores, defaultDeadline, parseScore, toZonedInput, zipEntryNames, zonedToUtc } from "./cub";
import { addMonths, monthGrid } from "./dates";
import { manifest } from "./manifest";
import {
  cadenceChanged,
  datesForOccurrence,
  isFollowing,
  normalizeScope,
  occurrenceDays,
  planFollowingEdit,
  planOccurrences,
  seriesAction,
  sharedFields,
  windowOffsets,
} from "./recurrence";
import { eventFeedItem, filterFeed, issueFeedItem, stageOn, stageSpans, timelineBar, validateEventDates, weekSegments } from "./stages";
import { candidateCodes, guessMapping, matchStats, parseCsv, parseMailDate, parseRate, parseStatRows, ripCode } from "./stats";
import { normalizeWhatsWorking, whatsWorkingFacts, whatsWorkingPrompt, type WorkingSend } from "./whats-working";

describe("manifest", () => {
  it("is the Calendar on the editorial route", () => {
    expect(manifest.id).toBe("editorial");
    expect(manifest.slug).toBe("editorial");
    expect(manifest.name).toBe("Calendar");
    expect(manifest.nav[0]).toMatchObject({ href: "/editorial", permission: "editorial.read" });
  });
});

const ev = { marketingStart: "2026-11-01", eventDate: "2026-11-10", eventEnd: "2026-11-11", marketingEnd: "2026-11-15" };

describe("stages", () => {
  it("places each day in pre, event or post", () => {
    expect(stageOn(ev, "2026-10-31")).toBeNull();
    expect(stageOn(ev, "2026-11-01")).toBe("pre");
    expect(stageOn(ev, "2026-11-09")).toBe("pre");
    expect(stageOn(ev, "2026-11-10")).toBe("event");
    expect(stageOn(ev, "2026-11-11")).toBe("event");
    expect(stageOn(ev, "2026-11-12")).toBe("post");
    expect(stageOn(ev, "2026-11-15")).toBe("post");
    expect(stageOn(ev, "2026-11-16")).toBeNull();
  });

  it("builds contiguous spans and tolerates a missing end", () => {
    expect(stageSpans(ev)).toEqual([
      { stage: "pre", start: "2026-11-01", end: "2026-11-09" },
      { stage: "event", start: "2026-11-10", end: "2026-11-11" },
      { stage: "post", start: "2026-11-12", end: "2026-11-15" },
    ]);
    expect(stageSpans({ marketingStart: null, eventDate: "2026-11-10", eventEnd: null, marketingEnd: null })).toEqual([
      { stage: "event", start: "2026-11-10", end: "2026-11-10" },
    ]);
    expect(stageSpans({ marketingStart: "2026-11-01", eventDate: null, eventEnd: null, marketingEnd: null })).toEqual([]);
  });

  it("validates date order", () => {
    expect(validateEventDates(ev)).toEqual([]);
    expect(validateEventDates({ ...ev, eventEnd: "2026-11-09" })).toContain("The event end is before the event date.");
    expect(validateEventDates({ ...ev, marketingStart: "2026-11-12" })).toContain("Marketing starts after the event.");
    expect(validateEventDates({ ...ev, marketingEnd: "2026-11-10" })).toContain("Marketing ends before the event does.");
  });

  it("clips spans to a week row", () => {
    // Week of Sun Nov 8 – Sat Nov 14.
    expect(weekSegments(ev, "2026-11-08")).toEqual([
      { start: 0, end: 1, bar: "pre", continuesLeft: true, continuesRight: false },
      { start: 2, end: 3, bar: "event", continuesLeft: false, continuesRight: false },
      { start: 4, end: 6, bar: "post", continuesLeft: false, continuesRight: true },
    ]);
  });

  it("positions timeline bars", () => {
    expect(timelineBar("2026-11-01", "2026-11-10", "2026-11-01", "2026-11-30")).toEqual({ left: 0, width: (10 / 30) * 100 });
    expect(timelineBar("2026-10-01", "2026-10-02", "2026-11-01", "2026-11-30")).toBeNull();
  });

  it("filters and sorts the running list", () => {
    const items = [
      eventFeedItem({ ...ev, id: "e1", name: "Fall webinar", stage: "Scheduled", eventType: "Sales event", format: "Webinar", channels: ["Main room"], hosts: ["Ann"], offer: null, seriesId: null }),
      eventFeedItem({ marketingStart: null, eventDate: "2026-10-01", eventEnd: null, marketingEnd: null, id: "e2", name: "Old call", stage: "Recurring", eventType: null, format: null, channels: [], hosts: [], offer: null, seriesId: "s" }),
      issueFeedItem({ id: "i1", title: "Weekly issue", mailDate: "2026-11-12", status: "Planned", issueType: "Regular", publicationCode: "WR", subjectLines: ["Big news"], writer: null }),
    ];
    const today = "2026-11-12";
    expect(filterFeed(items, { today, upcoming: true }).map((i) => i.id)).toEqual(["e1", "i1"]);
    expect(filterFeed(items, { today, upcoming: false }).map((i) => i.id)).toEqual(["i1", "e1", "e2"]);
    expect(filterFeed(items, { today, kind: "issue" }).map((i) => i.id)).toEqual(["i1"]);
    expect(filterFeed(items, { today, channel: "Main room" }).map((i) => i.id)).toEqual(["e1"]);
    expect(filterFeed(items, { today, q: "big news" }).map((i) => i.id)).toEqual(["i1"]);
    expect(filterFeed(items, { today, hideRecurring: true }).map((i) => i.id)).not.toContain("e2");
    expect(filterFeed(items, { today, from: "2026-11-11", to: "2026-11-30" }).map((i) => i.id)).toEqual(["i1"]);
  });

  it("builds whole-week month grids", () => {
    const grid = monthGrid("2026-11");
    expect(grid[0]).toBe("2026-11-01");
    expect(grid.length % 7).toBe(0);
    expect(grid).toContain("2026-11-30");
    expect(monthGrid("2026-02")[0]).toBe("2026-02-01");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
  });
});

describe("recurrence", () => {
  it("generates cadences and clamps month ends", () => {
    expect(occurrenceDays({ frequency: "weekly", startsOn: "2026-11-03", until: "2026-11-24" }, "2027-01-01")).toEqual([
      "2026-11-03",
      "2026-11-10",
      "2026-11-17",
      "2026-11-24",
    ]);
    expect(occurrenceDays({ frequency: "biweekly", startsOn: "2026-11-03", until: "2026-11-30" }, "2027-01-01")).toEqual(["2026-11-03", "2026-11-17"]);
    expect(occurrenceDays({ frequency: "monthly", startsOn: "2026-01-31", until: "2026-04-30" }, "2027-01-01")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
    expect(occurrenceDays({ frequency: "quarterly", startsOn: "2026-01-15", until: null }, "2026-12-31")).toHaveLength(4);
  });

  it("copies the anchor's marketing window to each occurrence", () => {
    const offsets = windowOffsets(ev);
    expect(offsets).toEqual({ preDays: 9, eventDays: 1, postDays: 4 });
    expect(datesForOccurrence("2026-11-17", offsets)).toEqual({ marketingStart: "2026-11-08", eventDate: "2026-11-17", eventEnd: "2026-11-18", marketingEnd: "2026-11-22" });
    const planned = planOccurrences({ frequency: "weekly", startsOn: "2026-11-10", until: "2026-12-01", today: "2026-11-10", existingDays: ["2026-11-10"], offsets, after: "2026-11-10" });
    expect(planned.map((p) => p.eventDate)).toEqual(["2026-11-17", "2026-11-24", "2026-12-01"]);
  });

  it("treats anything but following as a single edit", () => {
    expect(normalizeScope("following")).toBe("following");
    expect(normalizeScope("series")).toBe("following");
    expect(normalizeScope("single")).toBe("single");
    expect(normalizeScope(undefined)).toBe("single");
    expect(normalizeScope("all")).toBe("single");
  });

  it("never copies dates or metrics across a series", () => {
    const shared = sharedFields({ name: "Call", hosts: ["A"], revenue: 900, peakAttendance: 40, eventDate: "2026-11-10", marketingEnd: "2026-11-12", notes: "x" });
    expect(shared).toEqual({ name: "Call", hosts: ["A"], notes: "x" });
  });

  const anchor = { id: "a", seriesId: "s", marketingStart: "2026-11-03", eventDate: "2026-11-10", eventEnd: null, marketingEnd: null };
  const occurrences = [
    { id: "past", seriesId: "s", marketingStart: null, eventDate: "2026-11-03", eventEnd: null, marketingEnd: null },
    anchor,
    { id: "next", seriesId: "s", marketingStart: "2026-11-10", eventDate: "2026-11-17", eventEnd: null, marketingEnd: "2026-11-18" },
    { id: "trashed", seriesId: "s", marketingStart: null, eventDate: "2026-11-24", eventEnd: null, marketingEnd: null, deletedAt: new Date() },
    { id: "other", seriesId: "t", marketingStart: null, eventDate: "2026-11-24", eventEnd: null, marketingEnd: null },
  ];

  it("reaches only later, live occurrences of the same series", () => {
    expect(occurrences.filter((o) => isFollowing(anchor, o)).map((o) => o.id)).toEqual(["next"]);
    expect(isFollowing({ ...anchor, seriesId: null }, occurrences[2]!)).toBe(false);
  });

  it("shifts later occurrences by the anchor's move and copies shared copy only", () => {
    const updates = planFollowingEdit({
      anchorBefore: anchor,
      edited: { name: "Wednesday call", eventDate: "2026-11-11", revenue: 5000, hosts: ["B"] },
      candidates: occurrences,
    });
    expect(updates).toEqual([
      {
        id: "next",
        shared: { name: "Wednesday call", hosts: ["B"] },
        dates: { marketingStart: "2026-11-11", eventDate: "2026-11-18", eventEnd: null, marketingEnd: "2026-11-19" },
      },
    ]);
    const unmoved = planFollowingEdit({ anchorBefore: anchor, edited: { name: "x", eventDate: "2026-11-10" }, candidates: occurrences });
    expect(unmoved[0]!.dates.eventDate).toBe("2026-11-17");
  });

  it("decides what a save does to the series", () => {
    const series = { frequency: "weekly", until: null, active: true };
    // A single-occurrence edit never reshapes the series, whatever the form says.
    expect(seriesAction({ scope: "single", series, repeat: "monthly", until: "2027-01-01" })).toBe("none");
    expect(seriesAction({ scope: "single", series, repeat: null, until: null })).toBe("none");
    expect(seriesAction({ scope: "following", series: null, repeat: "weekly", until: null })).toBe("create");
    expect(seriesAction({ scope: "following", series: null, repeat: null, until: null })).toBe("none");
    expect(seriesAction({ scope: "following", series, repeat: null, until: null })).toBe("stop");
    expect(seriesAction({ scope: "following", series, repeat: "biweekly", until: null })).toBe("reschedule");
    expect(seriesAction({ scope: "following", series, repeat: "weekly", until: "2027-01-01" })).toBe("reschedule");
    expect(seriesAction({ scope: "following", series, repeat: "weekly", until: null })).toBe("propagate");
    expect(cadenceChanged({ ...series, active: false }, "weekly", null)).toBe(true);
  });
});

const CSV = `Day(Mail Date),Mailing e-List,Mailing Subject,Mailed,Opened %,Clicked % (Delivered),Total Gross Revenue
11/03/2026,WR - The Weekly Report,"Three charts, one idea",10000,40.5%,3.2%,"$1,200.50"
11/03/2026,WR - The Weekly Report,Unrelated subject,500,20%,1%,0
11/04/2026,Morning Brief,Coffee and markets,8000,30,2,0
11/05/2026,ZZ - Unknown list,Hello,100,10,1,0
bad date,WR - The Weekly Report,x,1,1,1,1
`;

describe("send stats import", () => {
  const rows = parseCsv(CSV);
  const mapping = guessMapping(rows[0]!);

  it("parses quoted CSV and guesses the columns", () => {
    expect(rows).toHaveLength(6);
    expect(rows[1]![2]).toBe("Three charts, one idea");
    expect(mapping).toMatchObject({ mailDate: 0, list: 1, subject: 2, delivered: 3, openRate: 4, clickRate: 5, revenue: 6 });
    expect(parseCsv('a,"b ""q"""\r\n\r\n1,2')).toEqual([["a", 'b "q"'], ["1", "2"]]);
  });

  it("reads rates, dates and codes", () => {
    expect(parseRate("4.23%", "ratio")).toBeCloseTo(0.0423);
    expect(parseRate("4.23", "percent")).toBeCloseTo(0.0423);
    expect(parseRate("0.0423", "ratio")).toBeCloseTo(0.0423);
    expect(parseRate("", "percent")).toBeNull();
    expect(parseMailDate("11/3/26")).toBe("2026-11-03");
    expect(parseMailDate("2026-11-03 09:00")).toBe("2026-11-03");
    expect(parseMailDate("02/30/2026")).toBeNull();
    expect(ripCode("WR - The Weekly Report")).toBe("WR");
    expect(ripCode("[mb] Morning")).toBe("MB");
    expect(candidateCodes("Morning Brief", [{ code: "MB", name: "Morning Brief" }])).toEqual(["MB", "MORNING"]);
  });

  it("matches by mail date + publication, with subject as the tie-breaker", () => {
    const parsed = parseStatRows(rows, mapping, "percent");
    expect(parsed[0]).toMatchObject({ mailDate: "2026-11-03", delivered: 10000, revenue: 1200.5 });
    expect(parsed[0]!.openRate).toBeCloseTo(0.405);
    const issues = [
      { id: "wr-a", publicationCode: "WR", mailDate: "2026-11-03", title: "Other topic", subjectLines: ["Unrelated subject"] },
      { id: "wr-b", publicationCode: "WR", mailDate: "2026-11-03", title: "Charts", subjectLines: ["Three charts, one idea"] },
      { id: "mb", publicationCode: "MB", mailDate: "2026-11-04", title: "Coffee", subjectLines: [] },
    ];
    const pubs = [
      { code: "WR", name: "The Weekly Report" },
      { code: "MB", name: "Morning Brief" },
    ];
    const { matches, unmatched } = matchStats(parsed, issues, pubs);
    const byIssue = Object.fromEntries(matches.map((m) => [m.issueId, m]));
    expect(byIssue["wr-b"]!.row.delivered).toBe(10000);
    expect(byIssue["wr-a"]!.row.delivered).toBe(500);
    expect(byIssue["mb"]!.pubCode).toBe("MB");
    expect(unmatched.map((u) => u.reason)).toEqual(["Unknown publication ZZ", "No readable mail date"]);
  });

  it("keeps the better row when two rows hit one issue", () => {
    const parsed = parseStatRows(rows, mapping, "percent").slice(0, 2);
    const { matches, unmatched } = matchStats(parsed, [{ id: "only", publicationCode: "WR", mailDate: "2026-11-03", title: "x", subjectLines: ["Three charts, one idea"] }], [{ code: "WR", name: "WR" }]);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.row.delivered).toBe(10000);
    expect(unmatched[0]!.reason).toMatch(/better/);
  });
});

describe("analytics", () => {
  const rows: SendRow[] = [
    toSendRow({ mailDate: "2026-11-02", pubCode: "A", delivered: 100000, openRate: 0.5, clickRate: 0.05, revenue: 1000, totalOpened: null, totalClicked: null, unsubscribes: 10 })!,
    toSendRow({ mailDate: "2026-11-04", pubCode: "B", delivered: 1000, openRate: 0.1, clickRate: 0.01, revenue: 0, totalOpened: null, totalClicked: null, unsubscribes: 0 })!,
    toSendRow({ mailDate: "2026-12-01", pubCode: "A", delivered: 2000, openRate: null, clickRate: null, revenue: 50, totalOpened: 600, totalClicked: 20, unsubscribes: null })!,
  ];

  it("weights rates by send size instead of averaging percentages", () => {
    const [nov] = rollup(rows, "month");
    expect(nov!.bucket).toBe("2026-11");
    expect(nov!.mailed).toBe(101000);
    expect(nov!.openRate).toBeCloseTo(50100 / 101000);
    // A plain average of 50% and 10% would be 30%: the weighted rate stays near 50%.
    expect(nov!.openRate!).toBeGreaterThan(0.49);
    expect(nov!.clickToOpen).toBeCloseTo(5010 / 50100);
    expect(nov!.revenuePerThousand).toBeCloseTo((1000 / 101000) * 1000);
  });

  it("buckets by week, month and quarter and filters publications", () => {
    expect(bucketOf("2026-11-04", "week")).toBe("2026-11-02");
    expect(bucketOf("2026-11-01", "week")).toBe("2026-10-26");
    expect(bucketOf("2026-11-04", "quarter")).toBe("2026-Q4");
    expect(rollup(rows, "quarter")).toHaveLength(1);
    expect(rollup(rows, "month", ["B"])).toHaveLength(1);
    expect(totals(rows, ["A"]).mailed).toBe(102000);
  });

  it("falls back to raw totals only when a rate is missing", () => {
    expect(rows[2]!.opens).toBe(600);
    expect(rows[0]!.opens).toBe(50000);
  });

  it("makes axis ticks that never go negative", () => {
    expect(niceTicks([0.02, 0.05], true)[0]).toBe(0);
    const zoomed = niceTicks([0.41, 0.45], false);
    expect(zoomed[0]).toBeGreaterThan(0);
    expect(zoomed.every((t) => t >= 0)).toBe(true);
    expect(niceTicks([], false)).toEqual([0, 1]);
  });
});

describe("what's working", () => {
  const send = (issueId: string, pub: string, day: string, mailed: number, clicks: number, revenue: number): WorkingSend => ({
    issueId,
    title: `Issue ${issueId}`,
    pub,
    day,
    issueType: null,
    writer: null,
    subject: null,
    mailed,
    opens: mailed / 2,
    clicks,
    revenue,
  });
  const sends = [
    send("a1", "A", "2026-11-10", 10000, 500, 2000),
    send("a2", "A", "2026-11-11", 10000, 100, 200),
    send("a3", "A", "2026-11-12", 100, 50, 0),
    send("b1", "B", "2026-11-12", 1000, 30, 0),
    send("old", "A", "2026-09-01", 10000, 9000, 90000),
  ];

  it("ranks sends against their own publication from the data", () => {
    const facts = whatsWorkingFacts(sends, "2026-11-17", 30);
    expect(facts.sends).toBe(4);
    expect(facts.top[0]!.issueId).toBe("a1");
    expect(facts.top.map((t) => t.issueId)).not.toContain("old");
    // a3 is too small next to A's other sends to rank.
    expect(facts.top.map((t) => t.issueId)).not.toContain("a3");
    expect(facts.laggards.map((l) => l.issueId)).toContain("a2");
    const a = facts.publications.find((p) => p.code === "A")!;
    expect(a.clickRate).toBeCloseTo(650 / 20100);
  });

  it("puts brand context and facts in the prompt, and drops invented rows", () => {
    const facts = whatsWorkingFacts(sends, "2026-11-17", 30);
    const prompt = whatsWorkingPrompt(facts, "Brand: Test (General)");
    expect(prompt).toContain("Brand: Test (General)");
    expect(prompt).toContain('"issueId":"a1"');
    const clean = normalizeWhatsWorking(
      {
        summary: " ok ",
        patterns: ["p"],
        topPerformers: [
          { issueId: "a1", why: "good" },
          { issueId: "made-up", why: "x" },
        ],
        publications: [
          { code: "A", whatsWorking: "w", recommendation: "r" },
          { code: "Z", whatsWorking: "w", recommendation: "r" },
        ],
        tryNext: [],
      },
      facts,
    );
    expect(clean.summary).toBe("ok");
    expect(clean.topPerformers.map((t) => t.issueId)).toEqual(["a1"]);
    expect(clean.publications.map((p) => p.code)).toEqual(["A"]);
  });
});

describe("CUB Collector", () => {
  it("parses scores and averages them", () => {
    expect(parseScore("10")).toBe(10);
    expect(parseScore("0")).toBe(0);
    expect(parseScore("11")).toBeNull();
    expect(parseScore("7.5")).toBeNull();
    expect(parseScore("")).toBeNull();
    const avg = averageScores([
      { scoreHeadline: 8, scoreStory: 6, scoreOffer: 7, scoreOverall: 7 },
      { scoreHeadline: 9, scoreStory: 7, scoreOffer: 5, scoreOverall: 6 },
      { scoreHeadline: 6, scoreStory: 8, scoreOffer: 6, scoreOverall: 8 },
    ]);
    expect(avg).toMatchObject({ count: 3, scoreHeadline: 7.7, scoreStory: 7, scoreOffer: 6, scoreOverall: 7, overall: 6.9 });
    expect(averageScores([]).overall).toBeNull();
  });

  it("sets the default deadline two business days out at 3:30pm Eastern", () => {
    // Thursday Nov 19 2026, 10:00 ET → Monday Nov 23, 3:30pm EST (20:30 UTC).
    expect(defaultDeadline(new Date("2026-11-19T15:00:00Z")).toISOString()).toBe("2026-11-23T20:30:00.000Z");
    // Summer time: Monday Jul 6 → Wednesday Jul 8, 3:30pm EDT (19:30 UTC).
    expect(defaultDeadline(new Date("2026-07-06T14:00:00Z")).toISOString()).toBe("2026-07-08T19:30:00.000Z");
    expect(toZonedInput(zonedToUtc("2026-03-09", "09:05", "America/New_York"), "America/New_York")).toBe("2026-03-09T09:05");
  });

  it("names zip entries by reviewer without collisions", () => {
    expect(zipEntryNames([
      { reviewerName: "Ann Lee", filename: "draft.docx" },
      { reviewerName: "Ann Lee", filename: "draft.docx" },
      { reviewerName: "B/C", filename: "x.pdf" },
    ])).toEqual(["Ann Lee - draft.docx", "Ann Lee - draft (2).docx", "B C - x.pdf"]);
  });
});
