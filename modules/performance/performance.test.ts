import { describe, expect, it } from "vitest";
import { archiveMode, inlineMime, normalizeTicker } from "./archive";
import { bestClose, computeGain, describeSplit, formatPct, holdDays, inferSplitFactor, occSymbol, parseSplitFactor } from "./gain";
import { manifest } from "./manifest";
import { csvCell, parseCsv, parseDate, planImport, validatePosition } from "./positions";
import { computeStats, isoWeek, publicTrackRecord, weeklySummary, type StatPosition } from "./stats";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const TODAY = d("2026-11-17");

describe("manifest", () => {
  it("is Track Record on the performance module", () => {
    expect(manifest.id).toBe("performance");
    expect(manifest.slug).toBe("performance");
    expect(manifest.name).toBe("Track Record");
    expect(manifest.planEntitlement).toBe("performance");
    expect(manifest.permissions.map((p) => p.key)).toEqual(["performance.read", "performance.write"]);
  });
});

describe("computeGain", () => {
  it("measures a long from entry to the live quote", () => {
    const gain = computeGain({ basis: "TODAY", direction: "LONG", entryPrice: 100, quote: { price: 125, at: TODAY } });
    expect(gain.pct).toBeCloseTo(25);
    expect(gain.source).toBe("live");
    expect(gain.stale).toBe(false);
  });

  it("inverts a short", () => {
    expect(computeGain({ basis: "TODAY", direction: "SHORT", entryPrice: 100, quote: { price: 80, at: TODAY } }).pct).toBeCloseTo(20);
    expect(computeGain({ basis: "TODAY", direction: "SHORT", entryPrice: 100, quote: { price: 130, at: TODAY } }).pct).toBeCloseTo(-30);
  });

  it("freezes a closed position at exit and ignores the market", () => {
    const gain = computeGain({ basis: "EXIT", direction: "LONG", entryPrice: 50, exitPrice: 40, exitDate: d("2026-03-01"), quote: { price: 500, at: TODAY } });
    expect(gain.pct).toBeCloseTo(-20);
    expect(gain.source).toBe("exit");
    expect(gain.current).toBe(40);
  });

  it("reports missing when EXIT has no exit price, and none for NONE", () => {
    expect(computeGain({ basis: "EXIT", direction: "LONG", entryPrice: 50 }).source).toBe("missing");
    expect(computeGain({ basis: "NONE", direction: "LONG", entryPrice: 50, quote: { price: 60, at: TODAY } }).pct).toBeNull();
  });

  it("converts split-adjusted market prices into the entry's basis", () => {
    // Bought at $400 before a 4-for-1 split. The market's split-adjusted quote is $120 → $480 in entry terms.
    const gain = computeGain({ basis: "TODAY", direction: "LONG", entryPrice: 400, splitFactor: 4, quote: { price: 120, at: TODAY } });
    expect(gain.pct).toBeCloseTo(20);
    expect(gain.current).toBeCloseTo(480);
    expect(gain.splitNote).toMatch(/4-for-1/);
    // A 1-for-20 reverse split: entry $3.15, adjusted quote $63 → $3.15, flat.
    const reverse = computeGain({ basis: "TODAY", direction: "LONG", entryPrice: 3.15, splitFactor: 0.05, quote: { price: 63, at: TODAY } });
    expect(reverse.pct).toBeCloseTo(0);
    expect(describeSplit(0.05)).toMatch(/1-for-20 reverse/);
  });

  it("falls back to the stored quote, then to a recorded price, and flags it stale", () => {
    const stored = computeGain({ basis: "TODAY", direction: "LONG", entryPrice: 10, quote: { price: 12, at: d("2026-11-01"), stale: true } });
    expect(stored.pct).toBeCloseTo(20);
    expect(stored.source).toBe("stale");
    expect(stored.stale).toBe(true);
    const recorded = computeGain({ basis: "TODAY", direction: "LONG", entryPrice: 10, recorded: { price: 15, at: d("2026-10-01") } });
    expect(recorded.pct).toBeCloseTo(50);
    expect(recorded.source).toBe("recorded");
    expect(recorded.stale).toBe(true);
    expect(computeGain({ basis: "TODAY", direction: "LONG", entryPrice: 10 }).source).toBe("missing");
  });

  it("takes the best of recorded peak, market peak and quote for PEAK", () => {
    const long = computeGain({
      basis: "PEAK",
      direction: "LONG",
      entryPrice: 10,
      recordedPeak: { price: 30, at: d("2025-01-01") },
      marketPeak: { price: 35, at: d("2025-06-01") },
      quote: { price: 20, at: TODAY },
    });
    expect(long.pct).toBeCloseTo(250);
    expect(long.source).toBe("peak");
    expect(long.peak?.at?.toISOString().slice(0, 10)).toBe("2025-06-01");
    // For a short the best price is the lowest one.
    const short = computeGain({ basis: "PEAK", direction: "SHORT", entryPrice: 100, marketPeak: { price: 60, at: d("2025-02-01") }, quote: { price: 90, at: TODAY } });
    expect(short.pct).toBeCloseTo(40);
  });

  it("never lets a later quote raise a closed position's peak", () => {
    const gain = computeGain({ basis: "EXIT", direction: "LONG", entryPrice: 10, exitPrice: 12, exitDate: d("2026-01-01"), marketPeak: { price: 14, at: d("2025-12-01") }, quote: { price: 99, at: TODAY } });
    expect(gain.peak?.price).toBe(14);
  });

  it("rejects bad entry prices", () => {
    expect(computeGain({ basis: "TODAY", direction: "LONG", entryPrice: 0, quote: { price: 1, at: TODAY } }).source).toBe("missing");
    expect(computeGain({ basis: "TODAY", direction: "LONG", entryPrice: null, quote: { price: 1, at: TODAY } }).pct).toBeNull();
  });
});

describe("splits and helpers", () => {
  it("infers a split from the entry price and the adjusted close on the entry date", () => {
    expect(inferSplitFactor(101, 100)).toBe(1);
    expect(inferSplitFactor(400, 101)).toBe(4);
    expect(inferSplitFactor(3.15, 63.4)).toBeCloseTo(0.05);
    expect(inferSplitFactor(9450, 3.15)).toBe(3000);
    expect(inferSplitFactor(100, 62)).toBeNull(); // 1.61x is no clean split: a person decides
  });

  it("parses split notation", () => {
    expect(parseSplitFactor("4:1")).toBe(4);
    expect(parseSplitFactor("1-for-20")).toBeCloseTo(0.05);
    expect(parseSplitFactor("2")).toBe(2);
    expect(parseSplitFactor("x")).toBeNull();
  });

  it("finds the best close for each direction", () => {
    const bars = [
      { t: d("2026-01-02").getTime(), c: 10 },
      { t: d("2026-01-03").getTime(), c: 14 },
      { t: d("2026-01-04").getTime(), c: 8 },
    ];
    expect(bestClose("LONG", bars)?.price).toBe(14);
    expect(bestClose("SHORT", bars)?.price).toBe(8);
    expect(bestClose("LONG", [])).toBeNull();
  });

  it("counts calendar days and formats", () => {
    expect(holdDays(d("2026-01-01"), d("2026-01-31"))).toBe(30);
    expect(formatPct(12.345)).toBe("+12.3%");
    expect(formatPct(-3)).toBe("-3.0%");
    expect(formatPct(null)).toBe("—");
    expect(occSymbol({ underlying: "aapl", expiry: d("2025-01-17"), right: "CALL", strike: 150 })).toBe("O:AAPL250117C00150000");
  });
});

function pos(partial: Partial<StatPosition> & { id: string; gainPct: number | null }): StatPosition {
  return {
    symbol: partial.id.toUpperCase(),
    name: "",
    direction: "LONG",
    status: "CLOSED",
    entryDate: d("2026-01-05"),
    exitDate: d("2026-02-05"),
    entryPrice: 10,
    exitPrice: 11,
    holdDays: 31,
    weight: 1,
    ...partial,
  };
}

const BOOK: StatPosition[] = [
  pos({ id: "a", gainPct: 40, holdDays: 10, exitDate: d("2026-03-01") }),
  pos({ id: "b", gainPct: -10, holdDays: 20, exitDate: d("2026-04-01") }),
  pos({ id: "c", gainPct: 10, holdDays: 30, weight: 2, exitDate: d("2026-02-01") }),
  pos({ id: "d", gainPct: -20, holdDays: 40, exitDate: d("2026-11-17") }),
  pos({ id: "e", gainPct: 5, status: "OPEN", exitDate: null, exitPrice: null, holdDays: 100 }),
  pos({ id: "f", gainPct: null, status: "OPEN", exitDate: null, exitPrice: null }),
];

describe("computeStats", () => {
  it("computes win rate, averages, best, worst and holding period from closed positions", () => {
    const stats = computeStats(BOOK);
    expect(stats.closed).toBe(4);
    expect(stats.open).toBe(2);
    expect(stats.winners).toBe(2);
    expect(stats.losers).toBe(2);
    expect(stats.winRate).toBe(0.5);
    expect(stats.avgGain).toBeCloseTo(5);
    expect(stats.weightedAvgGain).toBeCloseTo((40 - 10 + 20 - 20) / 5);
    expect(stats.medianGain).toBeCloseTo(0);
    expect(stats.avgHoldDays).toBeCloseTo(25);
    expect(stats.best?.symbol).toBe("A");
    expect(stats.worst?.symbol).toBe("D");
    expect(stats.avgOpenGain).toBe(5);
    expect(stats.openPriced).toBe(1);
  });

  it("handles an empty book", () => {
    const stats = computeStats([]);
    expect(stats.winRate).toBeNull();
    expect(stats.best).toBeNull();
  });
});

describe("publicTrackRecord", () => {
  it("shows closed trades only by default, in date order, with honest stats and no loser fields", () => {
    const view = publicTrackRecord(BOOK);
    expect(view.trades.every((t) => t.status === "CLOSED")).toBe(true);
    expect(view.trades.map((t) => t.symbol)).toEqual(["D", "B", "A", "C"]);
    expect(view.stats.winRate).toBe(0.5); // losers still count in the rate
    expect(view.stats.best?.symbol).toBe("A");
    expect(Object.keys(view.stats).sort()).toEqual(["avgGain", "avgHoldDays", "best", "closed", "winRate"]);
    const json = JSON.stringify(view);
    expect(json).not.toMatch(/worst|loser/i);
  });

  it("adds open positions only when asked", () => {
    const view = publicTrackRecord(BOOK, { includeOpen: true });
    expect(view.trades.filter((t) => t.status === "OPEN").map((t) => t.symbol).sort()).toEqual(["E", "F"]);
    expect(view.includesOpen).toBe(true);
  });
});

describe("weekly summary", () => {
  it("keys weeks the ISO way", () => {
    expect(isoWeek(d("2026-11-17"))).toBe("2026-W47");
    expect(isoWeek(d("2027-01-01"))).toBe("2026-W53");
  });

  it("is aggregates only: no symbols and no loser lists", () => {
    const note = weeklySummary({ portfolioName: "Main", publication: "Gazette", positions: BOOK, today: TODAY });
    expect(note.week).toBe("2026-W47");
    expect(note.body).toMatch(/Recommendations closed: 1/);
    expect(note.body).toMatch(/Win rate: 50%/);
    for (const symbol of ["A", "B", "C", "D", "E", "F"].map((s) => new RegExp(`\\b${s}\\b`))) expect(note.body).not.toMatch(symbol);
    expect(note.body).not.toMatch(/worst|loser/i);
  });
});

describe("positions and import", () => {
  it("validates a recommendation", () => {
    const ok = validatePosition({ symbol: "aapl", direction: "Buy", entryDate: "1/6/2026", entryPrice: "$180.25" }, TODAY);
    expect(ok.ok && ok.draft).toMatchObject({ symbol: "AAPL", direction: "LONG", assetType: "STOCK", entryPrice: 180.25, priceSymbol: "AAPL" });
    const bad = validatePosition({ symbol: "", entryDate: "2027-01-01", entryPrice: "-1", exitPrice: "5" }, TODAY);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join(" ")).toMatch(/Symbol is required.*future.*positive.*exit date/);
  });

  it("builds an OCC symbol for options and requires the contract fields", () => {
    const ok = validatePosition({ symbol: "NVDA", assetType: "call", strike: "150", expiry: "2026-12-18", entryDate: "2026-10-01", entryPrice: "4.20" }, TODAY);
    expect(ok.ok && ok.draft.priceSymbol).toBe("O:NVDA261218C00150000");
    expect(validatePosition({ symbol: "NVDA", assetType: "option", entryDate: "2026-10-01", entryPrice: "4" }, TODAY).ok).toBe(false);
  });

  it("parses dates and quoted CSV", () => {
    expect(parseDate("2026-02-30")).toBe("invalid");
    expect(parseDate("3/4/26")?.toString()).toBe(d("2026-03-04").toString());
    expect(parseCsv('a,b\n"x, y","say ""hi"""\r\n')).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(csvCell("=HYPERLINK()")).toBe("'=HYPERLINK()");
    expect(csvCell(-3.5)).toBe("-3.5");
  });

  it("plans an import: create, close, skip duplicates and report errors", () => {
    const csv = [
      "Portfolio,Ticker,Side,Entry Date,Entry Price,Exit Date,Exit Price,Mystery",
      "Main,AAPL,long,2026-01-06,180.25,,,x",
      "Main,MSFT,short,2026-03-02,420,2026-03-20,401.5,",
      "Main,MSFT,short,2026-03-02,420,2026-03-20,401.5,",
      "Growth,XOM,long,2026-02-01,108.40,,,",
      "Main,BAD,sideways,2026-02-01,10,,,",
    ].join("\n");
    const plan = planImport({
      csv,
      defaultPortfolio: "",
      portfolios: ["Main"],
      existing: [{ id: "p1", portfolioName: "main", symbol: "MSFT", direction: "SHORT", entryDate: d("2026-03-02"), status: "OPEN" }],
      today: TODAY,
    });
    expect(plan.rows.map((r) => r.action)).toEqual(["create", "close", "skip", "create", "error"]);
    expect(plan.rows[1]?.existingId).toBe("p1");
    expect(plan.newPortfolios).toEqual(["Growth"]);
    expect(plan.unknownColumns).toEqual(["Mystery"]);
    expect(plan.counts).toEqual({ create: 2, close: 1, skip: 1, error: 1 });
  });

  it("uses the chosen portfolio when the file has no portfolio column", () => {
    const plan = planImport({ csv: "symbol,entry date,entry price\nKO,2026-05-01,60", defaultPortfolio: "Income", portfolios: ["Income"], existing: [], today: TODAY });
    expect(plan.rows[0]).toMatchObject({ action: "create", portfolio: "Income" });
    expect(plan.newPortfolios).toEqual([]);
  });
});

describe("archive", () => {
  it("lists nothing until an expert is picked or a ticker searched", () => {
    expect(archiveMode({})).toEqual({ kind: "none" });
    expect(archiveMode({ expert: "not-an-id" })).toEqual({ kind: "none" });
    const id = "6f1c2c8e-1234-4abc-9def-0123456789ab";
    expect(archiveMode({ expert: id })).toEqual({ kind: "expert", expertId: id });
    expect(archiveMode({ expert: id, q: " $nvda " })).toEqual({ kind: "ticker", ticker: "NVDA" });
    expect(normalizeTicker("brk.b")).toBe("BRK.B");
    expect(inlineMime("image/png")).toBe(true);
    expect(inlineMime("text/html")).toBe(false);
  });
});
