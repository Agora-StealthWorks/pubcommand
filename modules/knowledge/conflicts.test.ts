import { describe, expect, it } from "vitest";
import {
  detectRuleConflicts,
  extractCodes,
  extractEditorClaims,
  extractFrequencies,
  extractLaunchDates,
  extractNamesForCode,
  extractPrices,
  extractStatements,
  extractTitles,
  factHash,
  factPrices,
  factsHash,
  formatDateLike,
  locateQuote,
  normalizeAiConflicts,
  notesHash,
  parseFactDate,
  reconcileConflicts,
  recheckReason,
  replacePassage,
  splitPassages,
  suggestPassageFix,
  titlesAgree,
  type ConflictEntity,
  type ConflictNote,
  type StoredConflict,
} from "./conflicts";

const pub: ConflictEntity = {
  kind: "publication",
  id: "p1",
  name: "The Daily Edge",
  aliases: ["TDE"],
  fields: {
    name: "The Daily Edge",
    code: "TDE",
    status: "active",
    frequency: "Weekly",
    launchDate: "2024-05-01",
    offers: ["Annual · $49 · per year", "Monthly · $5 · per month"],
    editors: ["Ada Lee (Lead editor)"],
  },
  otherNames: ["Gazette Sunday Brief", "Bo Park"],
  knownPublications: [
    { name: "The Daily Edge", code: "TDE" },
    { name: "Gazette Sunday Brief", code: "GSB" },
  ],
};

const editor: ConflictEntity = {
  kind: "editor",
  id: "e1",
  name: "Ada Lee",
  aliases: [],
  fields: { name: "Ada Lee", title: "Chief Strategist", status: "active", publications: ["The Daily Edge (TDE, Lead editor)"] },
  otherNames: ["The Daily Edge", "Gazette Sunday Brief"],
  knownPublications: pub.knownPublications,
};

const note = (id: string, body: string, strength: 1 | 2 | 3 = 1, title = "Notes"): ConflictNote => ({ id, title, body, strength });

describe("extractors", () => {
  it("prices with terms before and after", () => {
    expect(extractPrices("It costs $79 per year.")).toEqual([{ amount: 79, term: "year", raw: "$79 per year" }]);
    expect(extractPrices("The annual subscription is $1,995.")).toEqual([{ amount: 1995, term: "year", raw: "$1,995" }]);
    expect(extractPrices("$5/month or $49.50 a year")).toEqual([
      { amount: 5, term: "month", raw: "$5/month" },
      { amount: 49.5, term: "year", raw: "$49.50 a year" },
    ]);
    expect(extractPrices("a $2 million portfolio")).toEqual([]);
    expect(factPrices(["Annual · $49 · per year", "Lifetime · $999"])).toMatchObject([
      { amount: 49, term: "year" },
      { amount: 999, term: "lifetime" },
    ]);
  });

  it("launch dates at year, month and day precision", () => {
    expect(extractLaunchDates("It launched in 2019 with a bang.")).toMatchObject([{ year: 2019, month: null }]);
    expect(extractLaunchDates("Founded in March 2021.")).toMatchObject([{ year: 2021, month: 3, day: null }]);
    expect(extractLaunchDates("It first published on May 1st, 2024.")).toMatchObject([{ year: 2024, month: 5, day: 1 }]);
    expect(extractLaunchDates("Launch date: 2024-05-01")).toMatchObject([{ year: 2024, month: 5, day: 1 }]);
    expect(extractLaunchDates("Published since 2018.")).toMatchObject([{ year: 2018 }]);
    expect(extractLaunchDates("Revenue doubled in 2019.")).toEqual([]);
    const fact = parseFactDate("2024-05-01")!;
    expect(formatDateLike(fact, { year: 2019, month: null, day: null, raw: "2019" })).toBe("2024");
    expect(formatDateLike(fact, { year: 2021, month: 3, day: null, raw: "March 2021" })).toBe("May 2024");
    expect(formatDateLike(fact, { year: 2021, month: 3, day: 2, raw: "March 2, 2021" })).toBe("May 1, 2024");
  });

  it("frequencies, most specific first", () => {
    expect(extractFrequencies("A biweekly letter.").map((f) => f.value)).toEqual(["Every two weeks"]);
    expect(extractFrequencies("It comes out every Monday.").map((f) => f.value)).toEqual(["Weekly"]);
    expect(extractFrequencies("Sent twice a week.").map((f) => f.value)).toEqual(["Several times a week"]);
    expect(extractFrequencies("Monday through Friday").map((f) => f.value)).toEqual(["Weekdays"]);
    expect(extractFrequencies("a daily note and a monthly call").map((f) => f.value)).toEqual(["Daily", "Monthly"]);
  });

  it("names, codes, editors and titles", () => {
    expect(extractCodes("The Daily Edge (TDX) is weekly.", "The Daily Edge")).toEqual([{ code: "TDX", raw: "TDX" }]);
    expect(extractCodes("Publication code: TDE.", "x")).toEqual([{ code: "TDE", raw: "TDE" }]);
    expect(extractNamesForCode("Our flagship, Daily Edge Pro (TDE), is weekly.", "TDE")).toEqual([{ name: "Daily Edge Pro", raw: "Daily Edge Pro" }]);
    expect(extractEditorClaims("The Daily Edge is edited by Bo Park.").map((c) => c.name)).toEqual(["Bo Park"]);
    expect(extractEditorClaims("Bo Park writes it every week.").map((c) => c.name)).toEqual(["Bo Park"]);
    expect(extractEditorClaims("Ada Lee (Lead editor)", { heading: "Editors", listItem: true }).map((c) => c.name)).toEqual(["Ada Lee"]);
    expect(extractTitles("Ada Lee, Senior Analyst at Example Gazette, says…", "Ada Lee")).toEqual([{ title: "Senior Analyst", raw: "Senior Analyst" }]);
    expect(extractTitles("Ada Lee is the chief strategist of the firm.", "Ada Lee")[0]?.title).toBe("chief strategist");
    expect(extractTitles("Ada Lee, a former hedge fund manager, writes.", "Ada Lee")).toEqual([]);
    expect(titlesAgree("Chief Strategist", "chief strategist")).toBe(true);
    expect(titlesAgree("Chief Investment Strategist", "Chief Strategist")).toBe(true);
    expect(titlesAgree("Chief Strategist", "Senior Analyst")).toBe(false);
  });

  it("passages are verbatim substrings with their headings", () => {
    const body = "# The Daily Edge\n\nIt is weekly. It costs $49.\n\n## Price points\n- Annual: $49 per year\n";
    const passages = splitPassages(body);
    expect(passages.map((p) => p.text)).toEqual(["It is weekly.", "It costs $49.", "Annual: $49 per year"]);
    expect(passages[2]).toMatchObject({ heading: "Price points", listItem: true });
    for (const p of passages) expect(body.includes(p.text)).toBe(true);
  });
});

describe("rule conflicts", () => {
  it("flags contradicting prices, frequency, launch date, code, name and editor; not agreeing ones", () => {
    const body = [
      "The Daily Edge (TDX) is a daily newsletter that launched in 2019.",
      "An annual subscription to The Daily Edge costs $79 per year.",
      "The Daily Edge is edited by Bo Park.",
      "Daily Edge Pro (TDE) is our flagship.",
    ].join("\n");
    const found = detectRuleConflicts(pub, [note("n1", body)]);
    const byFact = Object.fromEntries(found.map((c) => [c.factKey, c]));
    expect(Object.keys(byFact).sort()).toEqual(["code", "editors", "frequency", "launchDate", "name", "offers"]);
    expect(byFact.offers).toMatchObject({ noteValue: "$79", suggestedValue: "$49", factValue: "Annual · $49 · per year; Monthly · $5 · per month" });
    expect(byFact.launchDate).toMatchObject({ noteValue: "2019", suggestedValue: "2024" });
    expect(byFact.code).toMatchObject({ noteValue: "TDX", suggestedValue: "TDE" });
    expect(byFact.editors).toMatchObject({ noteValue: "Bo Park", suggestedValue: "Ada Lee" });
    for (const c of found) expect(body.includes(c.quote)).toBe(true);
  });

  it("is quiet when the note agrees with the facts (e.g. the note Publication Setup itself wrote)", () => {
    const body = [
      "The Daily Edge (TDE) is a Example Gazette publication.",
      "Newsletter · Weekly · Active · launched 2024-05-01",
      "## Editors",
      "- Ada Lee (Lead editor)",
      "## Price points and offers",
      "- Annual · $49 · per year",
      "- Monthly · $5 · per month",
    ].join("\n");
    expect(detectRuleConflicts(pub, [note("n1", body, 2, "The Daily Edge (TDE)")])).toEqual([]);
    const statements = extractStatements(pub, [note("n1", body, 2)]);
    expect(statements.filter((s) => s.agrees).map((s) => s.factKey)).toEqual(expect.arrayContaining(["editors", "offers", "code"]));
  });

  it("ignores sentences about another entity and past-tense editor claims", () => {
    const body = "Gazette Sunday Brief costs $99 per year and is monthly.\nThe Daily Edge was formerly edited by Bo Park.";
    expect(detectRuleConflicts(pub, [note("n1", body, 3)])).toEqual([]);
  });

  it("editor: title, publication assignment and status", () => {
    const body = "Ada Lee, Senior Analyst, edits Gazette Sunday Brief. Ada Lee left the company in 2025.";
    const found = detectRuleConflicts(editor, [note("n2", body)]);
    expect(found.map((c) => c.factKey).sort()).toEqual(["publications", "status", "title"]);
    expect(found.find((c) => c.factKey === "title")).toMatchObject({ noteValue: "Senior Analyst", suggestedValue: "Chief Strategist" });
  });

  it("publication status: discontinued while active", () => {
    const found = detectRuleConflicts(pub, [note("n3", "The Daily Edge was discontinued last year.")]);
    expect(found).toMatchObject([{ factKey: "status", factValue: "active" }]);
  });
});

describe("quotes and fixes", () => {
  it("locates quotes across whitespace and replaces one passage", () => {
    const body = "Line one.\nThe Daily  Edge costs\n$79 per year. End.";
    expect(locateQuote(body, "The Daily Edge costs $79 per year.")).toEqual({ start: 10, end: 45 });
    expect(replacePassage(body, "The Daily Edge costs $79 per year.", "The Daily Edge costs $49 per year.")).toBe("Line one.\nThe Daily Edge costs $49 per year. End.");
    expect(replacePassage(body, "not there", "x")).toBeNull();
    expect(suggestPassageFix("It costs $79 per year.", "$79", "$49")).toBe("It costs $49 per year.");
    expect(suggestPassageFix("It costs $79.", null, null)).toBe("It costs $79.");
  });

  it("drops AI conflicts with invented quotes, unknown facts or notes", () => {
    const notes = [note("n1", "The Daily Edge goes out on Fridays to 40,000 readers.")];
    const raw = {
      conflicts: [
        { factKey: "frequency", noteId: "n1", noteSays: "goes out Fridays", quote: "The Daily Edge goes out on Fridays to 40,000 readers.", confidence: 0.4 },
        { factKey: "frequency", noteId: "n1", noteSays: "x", quote: "It is published daily.", confidence: 0.9 },
        { factKey: "nope", noteId: "n1", noteSays: "x", quote: "The Daily Edge goes out", confidence: 0.9 },
        { factKey: "launchDate", noteId: "n9", noteSays: "x", quote: "The Daily Edge goes out", confidence: 0.9 },
        { factKey: "status", noteId: "n1", noteSays: "readers", quote: "goes out on  Fridays", confidence: 0.8 },
      ],
    };
    expect(normalizeAiConflicts(raw, pub, notes)).toEqual([
      { factKey: "status", factValue: "active", noteId: "n1", noteSays: "readers", quote: "goes out on Fridays", noteValue: null, suggestedValue: null, confidence: 0.8, layer: "ai", rule: null },
    ]);
  });
});

describe("change detection", () => {
  it("re-checks only when facts or matching notes change", () => {
    const facts = factsHash(pub.fields);
    expect(factsHash({ ...pub.fields })).toBe(facts);
    expect(factsHash({ code: pub.fields.code!, ...pub.fields })).toBe(facts); // key order does not matter
    const notes = notesHash([{ id: "b", body: "x" }, { id: "a", body: "y" }]);
    expect(notesHash([{ id: "a", body: "y" }, { id: "b", body: "x" }])).toBe(notes);
    const previous = { factsHash: facts, notesHash: notes, status: "done" };
    expect(recheckReason(null, { factsHash: facts, notesHash: notes })).toBe("never-checked");
    expect(recheckReason(previous, { factsHash: facts, notesHash: notes })).toBeNull();
    expect(recheckReason(previous, { factsHash: factsHash({ ...pub.fields, frequency: "Daily" }), notesHash: notes })).toBe("facts-changed");
    expect(recheckReason(previous, { factsHash: facts, notesHash: notesHash([{ id: "a", body: "y!" }, { id: "b", body: "x" }]) })).toBe("notes-changed");
    expect(recheckReason({ ...previous, status: "failed" }, { factsHash: facts, notesHash: notes })).toBe("failed-before");
    expect(recheckReason(previous, { factsHash: facts, notesHash: notes }, true)).toBe("forced");
  });
});

describe("reconcile", () => {
  const candidate = detectRuleConflicts(pub, [note("n1", "The Daily Edge costs $79 per year.")])[0]!;
  const fh = { offers: factHash("offers", pub.fields.offers) };
  const nh = { n1: "h1" };
  const row = (patch: Partial<StoredConflict>): StoredConflict => ({ id: "c1", factKey: "offers", noteId: "n1", layer: "rule", status: "OPEN", resolution: null, factHash: fh.offers, noteHash: "h1", ...patch });

  it("creates new, refreshes open", () => {
    expect(reconcileConflicts({ existing: [], candidates: [candidate], factHashes: fh, noteHashes: nh, layersRun: ["rule"] }).create).toHaveLength(1);
    const plan = reconcileConflicts({ existing: [row({})], candidates: [candidate], factHashes: fh, noteHashes: nh, layersRun: ["rule"] });
    expect(plan.refresh).toMatchObject([{ id: "c1", clearResolution: false }]);
  });

  it("a dismissal sticks until the fact or the note changes", () => {
    const dismissed = row({ status: "DISMISSED", resolution: "dismissed" });
    expect(reconcileConflicts({ existing: [dismissed], candidates: [candidate], factHashes: fh, noteHashes: nh, layersRun: ["rule"] }).suppressed).toEqual(["c1"]);
    expect(reconcileConflicts({ existing: [dismissed], candidates: [candidate], factHashes: fh, noteHashes: { n1: "h2" }, layersRun: ["rule"] }).reopen).toHaveLength(1);
    expect(reconcileConflicts({ existing: [dismissed], candidates: [candidate], factHashes: { offers: "other" }, noteHashes: nh, layersRun: ["rule"] }).reopen).toHaveLength(1);
  });

  it("a conflict the re-check cleared reopens when it is found again", () => {
    const cleared = row({ status: "RESOLVED", resolution: "cleared" });
    expect(reconcileConflicts({ existing: [cleared], candidates: [candidate], factHashes: fh, noteHashes: nh, layersRun: ["rule"] }).reopen).toHaveLength(1);
  });

  it("clears open conflicts no longer found, but not AI ones when the AI did not run", () => {
    const plan = reconcileConflicts({ existing: [row({}), row({ id: "c2", layer: "ai", factKey: "status" })], candidates: [], factHashes: fh, noteHashes: nh, layersRun: ["rule"] });
    expect(plan.cleared).toEqual(["c1"]);
    const gone = reconcileConflicts({ existing: [row({ id: "c2", layer: "ai", factKey: "status" })], candidates: [], factHashes: fh, noteHashes: {}, layersRun: ["rule"] });
    expect(gone.cleared).toEqual(["c2"]);
  });

  it("a setup-to-fix decision is dropped when the fact changes", () => {
    const waiting = row({ resolution: "setup-to-fix" });
    expect(reconcileConflicts({ existing: [waiting], candidates: [candidate], factHashes: { offers: "changed" }, noteHashes: nh, layersRun: ["rule"] }).refresh[0]?.clearResolution).toBe(true);
  });
});
