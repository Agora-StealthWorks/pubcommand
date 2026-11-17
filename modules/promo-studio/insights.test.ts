import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { SUB_SCORES } from "./analysis";
import { buildDirectory, displayEntities, planMerge, resolveName, type EntityOverride } from "./entities";
import { applyClusters, buildLessonItems, lessonPrompt, type LessonSourcePromo } from "./lessons";
import {
  computeTiers,
  describeTier,
  enrich,
  guessMapping,
  mapRows,
  normalizeCode,
  parseCsv,
  parseDate,
  parseNumber,
  parseXlsx,
  promoCodeKeys,
  schemeFor,
  tierFor,
} from "./performance";
import { createQueue } from "./queue";
import { calibrationStats, leaveOneOut, scoreVector, similarOutcomes, type TrainingPair } from "./similar";

describe("CSV and XLSX reading", () => {
  it("parses quotes, embedded commas, newlines and a BOM", () => {
    const rows = parseCsv('﻿Code,Name,Revenue\r\nAB-1,"Gold, the sequel",$1,000\n"X2","Line\nbreak","2"\n\n');
    expect(rows[0]).toEqual(["Code", "Name", "Revenue"]);
    expect(rows[1]).toEqual(["AB-1", "Gold, the sequel", "$1", "000"]);
    expect(rows[2]).toEqual(["X2", "Line\nbreak", "2"]);
    expect(rows).toHaveLength(3);
  });

  it("detects semicolon and tab delimiters", () => {
    expect(parseCsv("a;b;c\n1;2;3")[1]).toEqual(["1", "2", "3"]);
    expect(parseCsv("a\tb\n1\t2")[1]).toEqual(["1", "2"]);
  });

  it("reads the first sheet of an xlsx with shared and inline strings", () => {
    const zip = zipSync({
      "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="Results" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/></Relationships>'),
      "xl/sharedStrings.xml": strToU8("<sst><si><t>Promo Code</t></si><si><t>Revenue</t></si><si><r><t>AB</t></r><r><t>1</t></r></si></sst>"),
      "xl/worksheets/sheet1.xml": strToU8(
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
          '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>12.5</v></c></row>' +
          '<row r="3"><c r="A3" t="inlineStr"><is><t>Z &amp; Q</t></is></c><c r="B3"><v>7</v></c></row></sheetData></worksheet>',
      ),
    });
    expect(parseXlsx(zip)).toEqual([
      ["Promo Code", "Revenue"],
      ["AB1", "", "12.5"],
      ["Z & Q", "7"],
    ]);
  });
});

describe("column mapping", () => {
  it("guesses fields from common headers, using each column once", () => {
    const mapping = guessMapping(["Creative Code", "Promo Name", "Mail Date", "Mailed", "Clicks", "Orders", "Net Revenue", "Gross Revenue", "List Cost"]);
    expect(mapping.code).toBe(0);
    expect(mapping.label).toBe(1);
    expect(mapping.startDate).toBe(2);
    expect(mapping.sent).toBe(3);
    expect(mapping.clicks).toBe(4);
    expect(mapping.orders).toBe(5);
    expect(mapping.revenue).toBe(6);
    expect(mapping.cost).toBe(8);
    expect(mapping.endDate).toBe(-1);
  });

  it("parses money, percents, parentheses and dates", () => {
    expect(parseNumber("$1,234.50")).toBe(1234.5);
    expect(parseNumber("(200)")).toBe(-200);
    expect(parseNumber("12%")).toBe(12);
    expect(parseNumber("1.2K")).toBe(1200);
    expect(parseNumber("n/a")).toBeNull();
    expect(parseNumber("abc")).toBeNull();
    expect(parseDate("2026-03-04")?.toISOString().slice(0, 10)).toBe("2026-03-04");
    expect(parseDate("3/4/26")?.toISOString().slice(0, 10)).toBe("2026-03-04");
    expect(parseDate("45000")?.toISOString().slice(0, 10)).toBe("2023-03-15");
    expect(parseDate("2/30/2026")).toBeNull();
  });

  it("sums rows per code, widens dates, skips totals and keeps unmapped columns", () => {
    const table = [
      ["Code", "Start", "End", "Sent", "Orders", "Revenue", "Owner"],
      ["ab-1", "2026-01-05", "2026-01-10", "1000", "10", "$500", "Kim"],
      ["AB 1", "2026-01-01", "2026-01-20", "500", "5", "$250", "Lee"],
      ["Total", "", "", "1500", "15", "$750", ""],
      ["", "", "", "", "", "", ""],
      ["CD2", "", "", "", "", "n/a", ""],
    ];
    const { rows, skipped } = mapRows(table, { ...guessMapping(table[0]!), startDate: 1, endDate: 2 });
    expect(skipped).toBe(2);
    const ab = rows.find((r) => r.codeKey === "AB1")!;
    expect(ab.rows).toBe(2);
    expect(ab.sent).toBe(1500);
    expect(ab.orders).toBe(15);
    expect(ab.revenue).toBe(750);
    expect(ab.startDate?.toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(ab.endDate?.toISOString().slice(0, 10)).toBe("2026-01-20");
    expect(ab.extra).toEqual({ Owner: "Kim" });
    expect(rows.find((r) => r.codeKey === "CD2")!.revenue).toBeNull();
  });

  it("normalizes codes and splits a promo's code list", () => {
    expect(normalizeCode(" fe-123 a ")).toBe("FE123A");
    expect(promoCodeKeys("ab-1, AB1; cd/2")).toEqual(["AB1", "CD2"]);
    expect(promoCodeKeys(null)).toEqual([]);
  });

  it("computes rates only when the denominator exists", () => {
    const e = enrich({ sent: 10000, views: null, clicks: 200, orders: 20, revenue: 2000, cost: 500 });
    expect(e.clickRate).toBe(2);
    expect(e.conversion).toBe(10);
    expect(e.revenuePerThousand).toBe(200);
    expect(e.epc).toBe(10);
    expect(e.roi).toBe(300);
    expect(enrich({ sent: null, views: null, clicks: null, orders: 1, revenue: 1, cost: 0 }).roi).toBeNull();
  });
});

describe("percentile tiers", () => {
  const cohort = (n: number, type = "Backend VSL") =>
    Array.from({ length: n }, (_, i) => ({ codeKey: `${type}-${i}`, cohort: type, orders: null, revenue: (i + 1) * 100 }));

  it("uses 5 tiers at n >= 20, 3 tiers at 8-19, none under 8", () => {
    expect(schemeFor(20)).toBe("5-tier");
    expect(schemeFor(19)).toBe("3-tier");
    expect(schemeFor(8)).toBe("3-tier");
    expect(schemeFor(7)).toBeNull();
    const five = computeTiers(cohort(20));
    expect(new Set(five.map((r) => r.tier))).toEqual(new Set(["top10", "upper", "middle", "lower", "bottom10"]));
    const three = computeTiers(cohort(8));
    expect(new Set(three.map((r) => r.tier))).toEqual(new Set(["top25", "middle50", "bottom25"]));
    const none = computeTiers(cohort(7));
    expect(none.every((r) => r.tier === null && r.percentile !== null)).toBe(true);
    expect(describeTier({ ...none[0]!, cohortSize: 7 })).toMatch(/only 7/);
  });

  it("ranks only within the promo type and excludes the promo itself", () => {
    const results = computeTiers([...cohort(8, "Front-end").map((r) => ({ ...r, orders: r.revenue, revenue: 1 })), ...cohort(3)]);
    const fe = results.filter((r) => r.cohort === "Front-end");
    expect(fe.every((r) => r.cohortSize === 8 && r.metric === "orders")).toBe(true);
    expect(fe.at(-1)!.percentile).toBe(1);
    expect(fe[0]!.percentile).toBe(0);
    expect(results.filter((r) => r.cohort === "Backend VSL").every((r) => r.tier === null && r.cohortSize === 3)).toBe(true);
  });

  it("counts ties as half and skips rows with no metric", () => {
    const results = computeTiers([
      { codeKey: "a", cohort: "X", orders: null, revenue: 5 },
      { codeKey: "b", cohort: "X", orders: null, revenue: 5 },
      { codeKey: "c", cohort: "X", orders: null, revenue: null },
    ]);
    expect(results[0]!.percentile).toBe(0.5);
    expect(results[2]!.metric).toBeNull();
    expect(results[2]!.cohortSize).toBe(0);
  });

  it("maps percentiles to bands", () => {
    expect(tierFor(0.95, "5-tier")).toBe("top10");
    expect(tierFor(0.05, "5-tier")).toBe("bottom10");
    expect(tierFor(0.5, "3-tier")).toBe("middle50");
  });
});

describe("similar-promo outcomes gate", () => {
  const scores = (values: number[]) => SUB_SCORES.map((name, i) => ({ name, score: values[i] ?? 5 }));

  it("needs a full set of sub-scores", () => {
    expect(scoreVector(scores([1, 2, 3, 4, 5, 6, 7, 8]))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(scoreVector(scores([1]).slice(0, 7))).toBeNull();
    expect(similarOutcomes({ id: "x", vector: null, promoType: null }, []).shown).toBe(false);
  });

  it("stays hidden under 30 pairs", () => {
    const pairs: TrainingPair[] = Array.from({ length: 29 }, (_, i) => ({ id: `p${i}`, title: `P${i}`, promoType: null, vector: Array(8).fill(i % 10), outcome: 5 }));
    const result = similarOutcomes({ id: "x", vector: Array(8).fill(5), promoType: null }, pairs);
    expect(result.shown).toBe(false);
    if (!result.shown) expect(result.reason).toMatch(/30/);
  });

  it("does not count the subject itself toward the 30", () => {
    const pairs: TrainingPair[] = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, title: `P${i}`, promoType: null, vector: Array(8).fill(i < 15 ? 2 : 9), outcome: i < 15 ? 2 : 9 }));
    expect(similarOutcomes({ id: "p0", vector: Array(8).fill(2), promoType: null }, pairs).shown).toBe(false);
  });

  it("shows when copy profiles predict outcomes better than the base rate", () => {
    const pairs: TrainingPair[] = Array.from({ length: 36 }, (_, i) => {
      const group = i % 3;
      const level = [2, 5, 9][group]!;
      return { id: `p${i}`, title: `P${i}`, promoType: null, vector: Array(8).fill(level + (i % 2) * 0.3), outcome: [2, 5, 8][group]! };
    });
    const { accuracy, baseRate } = leaveOneOut(pairs);
    expect(accuracy).toBeGreaterThan(baseRate);
    const result = similarOutcomes({ id: "new", vector: Array(8).fill(9), promoType: null }, pairs);
    expect(result.shown).toBe(true);
    if (result.shown) {
      expect(result.band).toBe("high");
      expect(result.agreement.k).toBe(5);
      expect(result.neighbours.every((n) => n.id !== "new")).toBe(true);
    }
  });

  it("hides when sub-scores carry no signal", () => {
    // Every promo looks the same but outcomes are spread: no better than guessing.
    const pairs: TrainingPair[] = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, title: `P${i}`, promoType: null, vector: Array(8).fill(5), outcome: i < 30 ? 5 : i < 35 ? 2 : 9 }));
    const result = similarOutcomes({ id: "new", vector: Array(8).fill(5), promoType: null }, pairs);
    expect(result.shown).toBe(false);
    if (!result.shown) expect(result.reason).toMatch(/no better/);
  });

  it("summarizes calibration gaps", () => {
    const stats = calibrationStats([
      { id: "a", title: "A", ai: 8, mine: 6, real: null },
      { id: "b", title: "B", ai: 6, mine: 6, real: 4 },
    ]);
    expect(stats.mine).toMatchObject({ n: 2, meanGap: 1, meanAbsGap: 1 });
    expect(stats.real).toMatchObject({ n: 1, meanGap: 2 });
  });
});

describe("lesson clustering input", () => {
  const promo = (over: Partial<LessonSourcePromo>): LessonSourcePromo => ({
    id: "p1",
    title: "Promo",
    promoType: "Front-end",
    lessons: [],
    strengths: [],
    fixes: [],
    percentile: null,
    tierLabel: null,
    ...over,
  });

  it("numbers items, drops short and same-promo duplicates, and adds results-backed items", () => {
    const items = buildLessonItems([
      promo({ id: "a", lessons: ["Lead with the reader's problem.", "lead with the READER'S problem", "Too short"], strengths: ["Specific proof in the first page"], percentile: 0.9 }),
      promo({ id: "b", lessons: ["Lead with the reader's problem."], fixes: ["The offer arrives too late"], percentile: 0.1 }),
      promo({ id: "c", strengths: ["ignored, no results"] }),
    ]);
    expect(items.map((i) => i.id)).toEqual(["L1", "L2", "L3", "L4"]);
    expect(items.filter((i) => i.fromResults).map((i) => i.text)).toEqual([
      "Worked in a top-quarter Front-end promo: Specific proof in the first page",
      "Weakness in a bottom-quarter Front-end promo: The offer arrives too late",
    ]);
    expect(lessonPrompt({ brandContext: "Brand: X", items, existing: [{ title: "Problem first", body: "..." }] })).toContain("L3: Lead with the reader's problem.");
  });

  it("caps the item count", () => {
    const many = promo({ lessons: Array.from({ length: 50 }, (_, i) => `Lesson number ${i} about something`) });
    expect(buildLessonItems([many], 10)).toHaveLength(10);
  });

  it("counts distinct promos from valid ids only, first claim wins, merges same titles", () => {
    const items = buildLessonItems([
      promo({ id: "a", lessons: ["Lead with the reader's problem.", "Name the enemy early on."] }),
      promo({ id: "b", lessons: ["Lead with the reader's problem."], strengths: ["Strong guarantee"], percentile: 0.8 }),
    ]);
    const themes = applyClusters(
      {
        themes: [
          { title: "Problem first", lesson: "Open on the problem.", category: "hook", itemIds: ["L1", "L3", "L99"], generic: true },
          { title: "problem  FIRST", lesson: "dup", category: "hook", itemIds: ["L4"], generic: false },
          { title: "Enemy", lesson: "Name it.", category: "nonsense", itemIds: ["L2", "L1"], generic: true },
          { title: "Empty", lesson: "No ids.", category: "other", itemIds: ["L1"], generic: true },
        ],
      },
      items,
    );
    expect(themes).toHaveLength(2);
    const first = themes[0]!;
    expect(first.title).toBe("Problem first");
    expect(first.promoIds).toEqual(["a", "b"]);
    expect(first.evidenceCount).toBe(2);
    expect(first.fromResults).toBe(true);
    expect(first.suggestedShared).toBe(false);
    expect(themes[1]).toMatchObject({ title: "Enemy", category: "other", evidenceCount: 1, promoIds: ["a"] });
  });
});

describe("directory overrides", () => {
  const promos = [
    { id: "1", title: "One", publisher: "Acme Press", gurus: ["Alex Green", "Pat Lee"], product: "Gold Letter", score: 8, realScore: 7 },
    { id: "2", title: "Two", publisher: "ACME press", gurus: ["alex green"], product: "Gold Letter", score: 6, realScore: null },
    { id: "3", title: "Three", publisher: "Acme Publishing", gurus: ["A. Green"], product: null, score: null, realScore: null },
  ];
  const ov = (fromName: string, toName: string | null, hidden = false, kind: EntityOverride["kind"] = "guru"): EntityOverride => ({
    kind,
    fromKey: fromName.toLowerCase().replace(/[^a-z0-9']+/g, " ").trim(),
    fromName,
    toName,
    hidden,
  });

  it("groups by normalized name with counts and averages", () => {
    const publishers = buildDirectory("publisher", promos, []);
    expect(publishers[0]).toMatchObject({ name: "Acme Press", promoCount: 2, averageScore: 7, averageReal: 7, aliases: [] });
    expect(publishers).toHaveLength(2);
  });

  it("merges, keeps aliases, and never rewrites the promo's own value", () => {
    const plan = planMerge("guru", "A. Green", "Alex Green", []);
    expect(plan.upsert).toEqual([{ fromKey: "a green", fromName: "A. Green", toName: "Alex Green" }]);
    const overrides = plan.upsert.map((u) => ({ kind: "guru" as const, ...u, hidden: false }));
    const gurus = buildDirectory("guru", promos, overrides);
    expect(gurus[0]).toMatchObject({ name: "Alex Green", promoCount: 3, aliases: ["A. Green"] });
    expect(promos[2]!.gurus).toEqual(["A. Green"]);
    expect(displayEntities(promos[2]!, overrides).gurus).toEqual([{ name: "Alex Green", original: "A. Green" }]);
  });

  it("re-points older merges instead of chaining, and refuses loops", () => {
    const existing = [ov("A. Green", "Alex Green")];
    const plan = planMerge("guru", "Alex Green", "Alexander Green", existing);
    expect(plan.upsert).toEqual([
      { fromKey: "alex green", fromName: "Alex Green", toName: "Alexander Green" },
      { fromKey: "a green", fromName: "A. Green", toName: "Alexander Green" },
    ]);
    expect(planMerge("guru", "Alex Green", "A. Green", existing).error).toBeTruthy();
    expect(planMerge("guru", "x", "", existing).error).toBeTruthy();
  });

  it("resolves chains safely and supports a respelling", () => {
    const loop = [ov("A", "B"), ov("B", "A")];
    expect(["A", "B"]).toContain(resolveName("guru", "A", loop));
    const respell = planMerge("guru", "alex green", "Alex Green", []);
    expect(respell.upsert[0]).toMatchObject({ fromKey: "alex green", toName: "Alex Green" });
  });

  it("flags hidden entries rather than dropping them", () => {
    const entries = buildDirectory("product", promos, [ov("Gold Letter", null, true, "product")]);
    expect(entries[0]).toMatchObject({ name: "Gold Letter", hidden: true, promoCount: 2 });
  });
});

describe("bulk queue", () => {
  it("never runs more than the limit at once and runs every job", async () => {
    let running = 0;
    let peak = 0;
    const done: string[] = [];
    const seenWaiting: number[] = [];
    const queue = createQueue(
      2,
      async (id) => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 5));
        running -= 1;
        done.push(id);
      },
      (waiting) => {
        seenWaiting.push(waiting.length);
      },
    );
    queue.add(["a", "b", "c", "d", "e", "a"]);
    await queue.idle();
    expect(peak).toBe(2);
    expect(done.sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(seenWaiting[0]).toBe(3);
  });

  it("keeps going after a failing job", async () => {
    const done: string[] = [];
    const queue = createQueue(2, async (id) => {
      if (id === "bad") throw new Error("x");
      done.push(id);
    });
    queue.add(["bad", "ok1", "ok2"]);
    await queue.idle();
    expect(done.sort()).toEqual(["ok1", "ok2"]);
  });
});
