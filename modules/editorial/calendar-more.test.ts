import { describe, expect, it } from "vitest";
import {
  changedValues,
  fromAirtableFields,
  guessFieldMap,
  isEditable,
  needsPush,
  openToken,
  pullDecision,
  readFieldMap,
  sealToken,
  toAirtableFields,
  type FieldMap,
} from "./airtable";
import { zonedToUtc } from "./cub";
import { cubMergeValues, effectiveTemplate, parseEmails, planCubTick, previousBusinessDay, reminderMoment, renderMerge, TEMPLATES, textToHtml, type TickRound } from "./emails";
import { acceptOption, moveOption, optionsWith, pipelineColumns, resolveOptions } from "./options";
import { daysAfter, extensionPlan, MAX_OCCURRENCES } from "./recurrence";
import { IGNORED_REASON, labelKey, matchStats, unmatchedLabels, type ParsedStatRow } from "./stats";
import { parseTickers, tickerMentions, tickerMetrics } from "./tickers";
import { eventRestoreBlocker, seriesRestoreSet } from "./trash";

const ET = "America/New_York";

describe("CUB email timing", () => {
  it("reminds at 9:05 am Eastern on the business day before the deadline", () => {
    const due = zonedToUtc("2026-11-19", "15:30", ET); // Thursday
    expect(reminderMoment(due).toISOString()).toBe(zonedToUtc("2026-11-18", "09:05", ET).toISOString());
    expect(reminderMoment(due).toISOString()).toBe("2026-11-18T14:05:00.000Z"); // EST = UTC-5
  });

  it("skips the weekend: a Monday deadline is reminded on Friday", () => {
    expect(previousBusinessDay("2026-11-23")).toBe("2026-11-20");
    const due = zonedToUtc("2026-11-23", "15:30", ET);
    expect(reminderMoment(due).toISOString()).toBe(zonedToUtc("2026-11-20", "09:05", ET).toISOString());
  });

  it("is DST-safe (summer time is UTC-4)", () => {
    expect(reminderMoment(zonedToUtc("2026-07-15", "15:30", ET)).toISOString()).toBe("2026-07-14T13:05:00.000Z");
  });

  const due = zonedToUtc("2026-11-19", "15:30", ET);
  const base: TickRound = { id: "r", createdAt: zonedToUtc("2026-11-17", "10:00", ET), dueAt: due, closedAt: null, requestSentAt: new Date(), reminderSentAt: null, deadlineNotifiedAt: null };

  it("does nothing before the reminder moment", () => {
    expect(planCubTick([base], zonedToUtc("2026-11-18", "09:00", ET))).toEqual({ remind: [], skipReminder: [], complete: [] });
  });

  it("sends the reminder on the first tick after 9:05", () => {
    expect(planCubTick([base], zonedToUtc("2026-11-18", "09:15", ET)).remind).toEqual(["r"]);
  });

  it("is idempotent: a stamped reminder or completion is never planned again", () => {
    const later = zonedToUtc("2026-11-18", "09:30", ET);
    expect(planCubTick([{ ...base, reminderSentAt: later }], later)).toEqual({ remind: [], skipReminder: [], complete: [] });
    const after = zonedToUtc("2026-11-19", "16:00", ET);
    expect(planCubTick([{ ...base, reminderSentAt: later, deadlineNotifiedAt: after }], after)).toEqual({ remind: [], skipReminder: [], complete: [] });
  });

  it("stamps without sending when the round started after the reminder moment", () => {
    const round = { ...base, createdAt: zonedToUtc("2026-11-18", "11:00", ET) };
    expect(planCubTick([round], zonedToUtc("2026-11-18", "11:15", ET))).toEqual({ remind: [], skipReminder: ["r"], complete: [] });
  });

  it("never reminds a closed round or one whose request never went out", () => {
    const now = zonedToUtc("2026-11-18", "09:15", ET);
    expect(planCubTick([{ ...base, closedAt: new Date() }], now).remind).toEqual([]);
    expect(planCubTick([{ ...base, requestSentAt: null }], now).remind).toEqual([]);
  });

  it("sends 'revisions ready' once the deadline has passed, even without a reminder", () => {
    expect(planCubTick([base], zonedToUtc("2026-11-19", "15:45", ET))).toEqual({ remind: [], skipReminder: [], complete: ["r"] });
  });
});

describe("CUB email templates", () => {
  it("merges tokens and leaves unknown ones blank", () => {
    const values = cubMergeValues({ promoName: "Gold Rush", deadline: "Thursday", reviewLink: "https://x.test/p/cub/r/abc" });
    expect(renderMerge("{{promoName}} due {{deadline}}: {{reviewLink}} {{nope}}", values)).toBe("Gold Rush due Thursday: https://x.test/p/cub/r/abc ");
    expect(renderMerge(TEMPLATES["cub-request"].body, values)).toContain("https://x.test/p/cub/r/abc");
    expect(renderMerge(TEMPLATES["cub-request"].body, values)).not.toMatch(/\n{3,}/);
  });

  it("uses the default when nothing is saved, and the saved copy otherwise", () => {
    expect(effectiveTemplate("cub-complete", null).subject).toBe(TEMPLATES["cub-complete"].subject);
    expect(effectiveTemplate("cub-complete", { subject: "Done", body: "B", recipients: [], enabled: false })).toEqual({ subject: "Done", body: "B", recipients: [], enabled: false });
  });

  it("parses typed reviewer lists", () => {
    expect(parseEmails("A@x.com, b@y.org;\nnot-an-email a@x.com")).toEqual({ valid: ["a@x.com", "b@y.org"], invalid: ["not-an-email"] });
  });

  it("renders text safely as HTML with clickable links", () => {
    const html = textToHtml("<b>Hi</b>\nhttps://a.test/x");
    expect(html).toContain("&lt;b&gt;Hi&lt;/b&gt;<br>");
    expect(html).toContain('<a href="https://a.test/x">');
  });
});

function row(list: string, mailDate = "2026-11-02", line = 2): ParsedStatRow {
  return { line, mailDate, list, subject: "", delivered: 1000, openRate: 0.3, clickRate: 0.02, clickToOpen: null, revenue: null, totalOpened: null, totalClicked: null, unsubscribes: null, complaints: null };
}

describe("saved list mappings", () => {
  const issues = [
    { id: "i-war", publicationCode: "WAR", mailDate: "2026-11-02", title: "War issue", subjectLines: [] },
    { id: "i-brief", publicationCode: "BRIEF", mailDate: "2026-11-02", title: "Brief", subjectLines: [] },
  ];
  const pubs = [
    { code: "WAR", name: "War Room" },
    { code: "BRIEF", name: "Morning Brief" },
  ];

  it("normalizes labels", () => {
    expect(labelKey("  FMDED -   Dedicated  ")).toBe("fmded - dedicated");
  });

  it("a saved mapping wins over the code read from the label", () => {
    const mappings = new Map([[labelKey("WAR - Weekend edition"), "BRIEF"]]);
    const { matches } = matchStats([row("WAR - Weekend edition")], issues, pubs, mappings);
    expect(matches.map((m) => [m.issueId, m.pubCode])).toEqual([["i-brief", "BRIEF"]]);
  });

  it("maps a label that could not be guessed", () => {
    const without = matchStats([row("Daily Market Wrap")], issues, pubs);
    expect(without.matches).toHaveLength(0);
    const withMap = matchStats([row("Daily Market Wrap")], issues, pubs, new Map([[labelKey("daily market wrap"), "WAR"]]));
    expect(withMap.matches[0]?.issueId).toBe("i-war");
  });

  it("an empty mapping ignores the list on purpose", () => {
    const { matches, unmatched } = matchStats([row("WAR - Dedicated send")], issues, pubs, new Map([[labelKey("WAR - Dedicated send"), ""]]));
    expect(matches).toHaveLength(0);
    expect(unmatched[0]?.reason).toBe(IGNORED_REASON);
  });

  it("lists distinct unmatched labels for the 'remember' form, skipping ignored and mapped ones", () => {
    const rows = [
      { line: 2, mailDate: "2026-11-02", list: "Daily Wrap", subject: "", reason: "Unknown publication DAILY" },
      { line: 3, mailDate: "2026-11-03", list: "daily  wrap", subject: "", reason: "Unknown publication DAILY" },
      { line: 4, mailDate: "2026-11-03", list: "Ded", subject: "", reason: IGNORED_REASON },
      { line: 5, mailDate: "2026-11-03", list: "Other", subject: "", reason: "x" },
    ];
    expect(unmatchedLabels(rows, new Map([["other", "WAR"]]))).toEqual([
      { label: "Daily Wrap", count: 2, mapped: false },
      { label: "Other", count: 1, mapped: true },
    ]);
  });
});

describe("trash and restore", () => {
  const at = new Date("2026-11-10T12:00:00Z");
  it("restores only the occurrences trashed with the series", () => {
    const occurrences = [
      { id: "with", deletedAt: new Date(at.getTime() + 20) },
      { id: "earlier", deletedAt: new Date("2026-11-01T00:00:00Z") },
      { id: "live", deletedAt: null },
    ];
    expect(seriesRestoreSet(at, occurrences)).toEqual(["with"]);
  });

  it("blocks restoring one occurrence while its series is in the trash", () => {
    expect(eventRestoreBlocker({ seriesId: "s" }, { deletedAt: at })).toMatch(/Restore the series/);
    expect(eventRestoreBlocker({ seriesId: "s" }, { deletedAt: null })).toBeNull();
    expect(eventRestoreBlocker({ seriesId: null }, null)).toBeNull();
  });
});

describe("series extension", () => {
  const weekly = { frequency: "weekly", startsOn: "2026-01-06", until: null, active: true, deletedAt: null };
  const occ = (day: string, deletedAt: Date | null = null) => ({ marketingStart: null, eventDate: day, eventEnd: null, marketingEnd: null, deletedAt });

  it("plans weekly occurrences up to N months ahead, after the latest one", () => {
    const plan = extensionPlan({ series: weekly, occurrences: [occ("2026-11-10"), occ("2026-11-17")], today: "2026-11-17", months: 1 });
    expect(plan.map((d) => d.eventDate)).toEqual(["2026-11-24", "2026-12-01", "2026-12-08", "2026-12-15"]);
  });

  it("is idempotent: once planned, the next run adds nothing", () => {
    const first = extensionPlan({ series: weekly, occurrences: [occ("2026-11-17")], today: "2026-11-17", months: 2 });
    const all = [occ("2026-11-17"), ...first.map((d) => ({ ...d, deletedAt: null }))];
    expect(extensionPlan({ series: weekly, occurrences: all, today: "2026-11-17", months: 2 })).toEqual([]);
  });

  it("never brings back an occurrence someone deleted", () => {
    const plan = extensionPlan({ series: weekly, occurrences: [occ("2026-11-17"), occ("2026-11-24", new Date())], today: "2026-11-17", months: 1 });
    expect(plan.map((d) => d.eventDate)).not.toContain("2026-11-24");
    expect(plan[0]?.eventDate).toBe("2026-12-01");
  });

  it("keeps each new occurrence's marketing window like the latest live one", () => {
    const template = { marketingStart: "2026-11-10", eventDate: "2026-11-17", eventEnd: null, marketingEnd: "2026-11-19", deletedAt: null };
    const [next] = extensionPlan({ series: weekly, occurrences: [template], today: "2026-11-17", months: 1 });
    expect(next).toEqual({ marketingStart: "2026-11-17", eventDate: "2026-11-24", eventEnd: null, marketingEnd: "2026-11-26" });
  });

  it("leaves ended, stopped and trashed series alone", () => {
    const o = [occ("2026-11-17")];
    expect(extensionPlan({ series: { ...weekly, until: "2027-06-01" }, occurrences: o, today: "2026-11-17" })).toEqual([]);
    expect(extensionPlan({ series: { ...weekly, active: false }, occurrences: o, today: "2026-11-17" })).toEqual([]);
    expect(extensionPlan({ series: { ...weekly, deletedAt: new Date() }, occurrences: o, today: "2026-11-17" })).toEqual([]);
  });

  it("extends series that began long ago (past the per-pass cap counted from the start)", () => {
    const old = { ...weekly, startsOn: "2020-01-07" };
    const plan = extensionPlan({ series: old, occurrences: [occ("2026-11-17")], today: "2026-11-17", months: 1 });
    expect(plan.length).toBeGreaterThan(0);
    expect(MAX_OCCURRENCES).toBeLessThan(300);
  });

  it("monthly keeps the anchor day and clamps short months", () => {
    expect(daysAfter({ frequency: "monthly", startsOn: "2026-01-31", until: null }, "2026-01-31", "2026-04-30")).toEqual(["2026-02-28", "2026-03-31", "2026-04-30"]);
  });
});

describe("Airtable mapping", () => {
  const map: FieldMap = {
    fields: { name: "Name", stage: "Stage", eventDate: "Event Date", hosts: "Hosts", channels: "Rooms", revenue: "Revenue", notes: "Days Out" },
    modifiedField: "Last Modified",
    types: { Name: "singleLineText", Stage: "singleSelect", "Event Date": "date", Hosts: "singleLineText", Rooms: "multipleSelects", Revenue: "currency", "Days Out": "formula", "Last Modified": "lastModifiedTime" },
  };

  it("writes back only mapped, editable fields, shaped to the Airtable type", () => {
    const fields = toAirtableFields("event", { name: "Live call", stage: "Planned", eventDate: "2026-11-20", hosts: ["Ann", "Bo"], channels: ["Room A"], revenue: 1200, notes: "x", offer: "Not mapped" }, map, ["Stage"]);
    expect(fields).toEqual({ Name: "Live call", "Event Date": "2026-11-20", Hosts: "Ann, Bo", Rooms: ["Room A"], Revenue: 1200 });
    expect(isEditable("Days Out", map, [])).toBe(false); // formula
    expect(isEditable("Last Modified", map, [])).toBe(false);
  });

  it("reads Airtable values back into calendar values", () => {
    const values = fromAirtableFields("event", { Name: " Live call ", "Event Date": "2026-11-20T00:00:00.000Z", Hosts: "Ann, Bo", Rooms: ["Room A", "Room A"], Revenue: "$1,200" }, map);
    expect(values).toMatchObject({ name: "Live call", eventDate: "2026-11-20", hosts: ["Ann", "Bo"], channels: ["Room A"], revenue: 1200, stage: null });
  });

  it("guesses a mapping from field names and reads stored maps defensively", () => {
    expect(guessFieldMap("issue", ["Topic", "List", "Issue Date", "Writer", "Junk"])).toEqual({ title: "Topic", publicationCode: "List", mailDate: "Issue Date", writer: "Writer" });
    expect(readFieldMap(null)).toEqual({ fields: {}, modifiedField: null, types: {} });
    expect(readFieldMap({ fields: { name: " Name ", bad: 3 }, modifiedField: "" })).toEqual({ fields: { name: "Name" }, modifiedField: null, types: {} });
  });

  it("finds only real changes", () => {
    expect(changedValues({ name: "A", hosts: [], notes: null, revenue: 5 }, { name: "A", hosts: null, notes: "", revenue: 6 })).toEqual({ revenue: 5 });
  });
});

describe("Airtable conflict rule", () => {
  const t0 = new Date("2026-11-17T10:00:00Z");
  const later = new Date("2026-11-17T11:00:00Z");
  const change = { name: "New" };

  it("creates unknown records and never resurrects trashed ones", () => {
    expect(pullDecision({ local: null, remoteModified: null, changes: change })).toBe("create");
    expect(pullDecision({ local: { updatedAt: t0, airtableSyncedAt: t0, deletedAt: t0 }, remoteModified: later, changes: change })).toBe("skip-trashed");
  });

  it("Airtable wins only when its record is newer than the local row", () => {
    expect(pullDecision({ local: { updatedAt: t0, airtableSyncedAt: t0, deletedAt: null }, remoteModified: later, changes: change })).toBe("update");
    expect(pullDecision({ local: { updatedAt: later, airtableSyncedAt: t0, deletedAt: null }, remoteModified: t0, changes: change })).toBe("skip-local-newer");
  });

  it("without a modified time, a local edit since the last sync is never overwritten", () => {
    expect(pullDecision({ local: { updatedAt: later, airtableSyncedAt: t0, deletedAt: null }, remoteModified: null, changes: change })).toBe("skip-local-newer");
    expect(pullDecision({ local: { updatedAt: t0, airtableSyncedAt: t0, deletedAt: null }, remoteModified: null, changes: change })).toBe("update");
    expect(pullDecision({ local: { updatedAt: t0, airtableSyncedAt: null, deletedAt: null }, remoteModified: null, changes: change })).toBe("skip-local-newer");
  });

  it("skips records with nothing to change", () => {
    expect(pullDecision({ local: { updatedAt: t0, airtableSyncedAt: t0, deletedAt: null }, remoteModified: later, changes: {} })).toBe("skip-same");
  });

  it("pushes rows never synced or edited since their sync", () => {
    expect(needsPush({ updatedAt: t0, airtableSyncedAt: null })).toBe(true);
    expect(needsPush({ updatedAt: later, airtableSyncedAt: t0 })).toBe(true);
    expect(needsPush({ updatedAt: t0, airtableSyncedAt: t0 })).toBe(false);
  });

  it("encrypts the token with AUTH_SECRET", () => {
    const sealed = sealToken("patSecret.123", "a-long-auth-secret-value");
    expect(sealed).not.toContain("patSecret");
    expect(openToken(sealed, "a-long-auth-secret-value")).toBe("patSecret.123");
    expect(() => openToken(sealed, "another-secret-value-xx")).toThrow();
  });
});

describe("field options and the promo pipeline", () => {
  it("uses defaults until a brand saves its own list", () => {
    const lists = resolveOptions([
      { field: "event.stage", value: "Booked", sortOrder: 1 },
      { field: "event.stage", value: "Draft", sortOrder: 0 },
    ]);
    expect(lists["event.stage"]).toEqual(["Draft", "Booked"]);
    expect(lists["issue.status"]).toContain("Sent");
  });

  it("strict fields accept listed values or the record's current one", () => {
    const lists = resolveOptions([]);
    expect(acceptOption("event.stage", "Planned", lists, null, "Idea")).toBe("Planned");
    expect(acceptOption("event.stage", "Made up", lists, null, "Idea")).toBe("Idea");
    expect(acceptOption("event.stage", "Old stage", lists, "Old stage", "Idea")).toBe("Old stage");
    expect(acceptOption("event.type", "Anything  typed", lists, null, "")).toBe("Anything typed");
    expect(optionsWith(["A"], "Z")).toEqual(["A", "Z"]);
  });

  it("reorders", () => {
    expect(moveOption(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveOption(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
  });

  it("groups promos by stage with an Other column for unknown stages", () => {
    const cols = pipelineColumns([{ id: "1", stage: "CUB" }, { id: "2", stage: null }, { id: "3", stage: "Gone" }], ["Idea", "CUB"]);
    expect(cols.map((c) => [c.stage, c.promos.map((p) => p.id)])).toEqual([["Idea", ["2"]], ["CUB", ["1"]], ["Other", ["3"]]]);
  });
});

describe("tickers", () => {
  it("parses ticker lists", () => {
    expect(parseTickers("$nvda, AAPL brk.b; toolongticker 12")).toEqual(["NVDA", "AAPL", "BRK.B"]);
  });

  it("computes issue close, peak and current from bars, not from text", () => {
    const bars = [
      { date: "2026-11-01", close: 90 },
      { date: "2026-11-03", close: 100 },
      { date: "2026-11-04", close: 130 },
      { date: "2026-11-05", close: 110 },
    ];
    expect(tickerMetrics(bars, "2026-11-02")).toEqual({ issueClose: 100, peak: 130, peakPct: 30, current: 110, currentPct: 10 });
    expect(tickerMetrics([], "2026-11-02").issueClose).toBeNull();
  });

  it("lists one row per ticker per dated issue", () => {
    const rows = tickerMentions([
      { id: "a", title: "A", publicationCode: "WAR", mailDate: "2026-11-01", tickers: ["NVDA", "AMD"] },
      { id: "b", title: "B", publicationCode: "WAR", mailDate: null, tickers: ["TSLA"] },
    ]);
    expect(rows.map((r) => r.ticker)).toEqual(["AMD", "NVDA"]);
  });
});
