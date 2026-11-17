import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MarketError,
  classifySymbol,
  cleanCompanyName,
  createMarket,
  memoryCache,
  parseBarsCsv,
  parseFredCsv,
  periodRange,
  planTickerRoute,
  ratioBars,
  resample,
  splitOnly,
  totalReturn,
  type FetchLike,
  type TiingoRow,
} from "./index";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

type Route = { match: RegExp; status?: number; body: string };
function fakeFetch(routes: Route[]) {
  const calls: string[] = [];
  const fetcher: FetchLike = async (url) => {
    calls.push(url);
    const route = routes.find((candidate) => candidate.match.test(url));
    if (!route) throw new TypeError("fetch failed");
    const status = route.status ?? 200;
    return { ok: status < 300, status, json: async () => JSON.parse(route.body), text: async () => route.body };
  };
  return { fetcher, calls };
}

const TODAY = () => "2026-11-14";

describe("routing", () => {
  it("classifies FRED, ratio and ticker symbols", () => {
    expect(classifySymbol("FRED:PCOPPUSDM")).toEqual({ kind: "fred", parts: ["PCOPPUSDM"] });
    expect(classifySymbol("cper / gld")).toEqual({ kind: "ratio", parts: ["cper", "gld"] });
    expect(classifySymbol(" amd ")).toEqual({ kind: "ticker", parts: ["AMD"] });
  });

  it("tries Massive first inside its window, Tiingo for old ranges and dividends", () => {
    const base = { today: "2026-11-14", massive: true, tiingo: true };
    expect(planTickerRoute({ ...base, from: "2021-01-01", adjust: "split" })).toEqual(["massive", "tiingo"]);
    expect(planTickerRoute({ ...base, from: "2010-01-01", adjust: "split" })).toEqual(["tiingo", "massive"]);
    expect(planTickerRoute({ ...base, from: "2021-01-01", adjust: "total" })).toEqual(["tiingo"]);
    expect(planTickerRoute({ ...base, from: "2010-01-01", adjust: "split", tiingo: false })).toEqual(["massive"]);
  });

  it("says plainly when no provider key is set", async () => {
    const market = createMarket({ fetch: fakeFetch([]).fetcher, today: TODAY });
    await expect(market.dailyBars("AMD", "2025-01-01", "2025-06-01")).rejects.toMatchObject({ code: "unconfigured" });
  });

  it("falls back to Tiingo when Massive is unreachable", async () => {
    const { fetcher, calls } = fakeFetch([{ match: /api\.tiingo\.com\/tiingo\/daily\/AAPL\/prices/, body: fixture("tiingo-split.json") }]);
    const market = createMarket({ massiveKey: "m", tiingoKey: "t", fetch: fetcher, today: TODAY });
    const series = await market.dailyBars("AAPL", "2020-08-27", "2020-09-01");
    expect(series.source).toBe("Tiingo");
    expect(series.warnings.join(" ")).toMatch(/Massive could not be reached/);
    expect(calls[0]).toMatch(/api\.massive\.com/);
  });

  it("maps an index to its ETF with a warning", async () => {
    const body = JSON.stringify({ results: [{ t: 1700000000000, o: 1, h: 1, l: 1, c: 450 }, { t: 1700086400000, o: 1, h: 1, l: 1, c: 455 }] });
    const { fetcher, calls } = fakeFetch([{ match: /aggs\/ticker\/SPY\/range/, body }]);
    const market = createMarket({ massiveKey: "m", fetch: fetcher, today: TODAY });
    const series = await market.dailyBars("SPX", "2023-11-14", "2023-11-20");
    expect(series.resolved).toBe("SPY");
    expect(series.name).toBe("S&P 500");
    expect(series.warnings[0]).toMatch(/SPX index data is not on our data plan/);
    expect(calls.some((url) => url.includes("/I:SPX/"))).toBe(false);
  });
});

describe("massive", () => {
  it("follows next_url across pages and caches the result", async () => {
    const { fetcher, calls } = fakeFetch([
      { match: /cursor=abc/, body: fixture("massive-aapl-page2.json") },
      { match: /aggs\/ticker\/AAPL\/range\/1\/day/, body: fixture("massive-aapl-page1.json") },
      { match: /reference\/tickers\/AAPL/, body: '{"results":{"name":"Apple Inc."}}' },
    ]);
    const cache = memoryCache();
    const market = createMarket({ massiveKey: "secret", fetch: fetcher, cache, today: TODAY });
    const series = await market.dailyBars("aapl", "2023-11-14", "2023-11-20");
    expect(series.bars.map((bar) => bar.c)).toEqual([131.88, 132.75, 134.1]);
    expect(series.name).toBe("Apple");
    expect(series.source).toBe("Massive");
    expect(calls.find((url) => url.includes("cursor=abc"))).toContain("apiKey=secret");
    const before = calls.length;
    await market.dailyBars("AAPL", "2023-11-14", "2023-11-20");
    expect(calls.length).toBe(before);
  });

  it("reports a 403 as not entitled", async () => {
    const { fetcher } = fakeFetch([{ match: /massive/, status: 403, body: '{"status":"NOT_AUTHORIZED"}' }]);
    const market = createMarket({ massiveKey: "m", fetch: fetcher, today: TODAY });
    await expect(market.dailyBars("ZZZ", "2025-01-01", "2025-02-01")).rejects.toMatchObject({ code: "not_entitled" });
  });
});

describe("tiingo adjustment", () => {
  const rows = JSON.parse(fixture("tiingo-split.json")) as TiingoRow[];

  it("rebuilds split-only prices from close and splitFactor", () => {
    const bars = splitOnly(rows);
    expect(bars[0]?.c).toBeCloseTo(500.04 / 4, 6);
    expect(bars[1]?.c).toBeCloseTo(499.23 / 4, 6);
    // The split day and later are raw closes: no dividends folded in.
    expect(bars[2]?.c).toBe(129.04);
    expect(bars[3]?.c).toBe(134.18);
  });

  it("uses adjClose only for total return", () => {
    expect(totalReturn(rows).map((bar) => bar.c)).toEqual([122.39, 122.19, 126.33, 131.36]);
  });

  it("warns when dividends are reinvested", async () => {
    const { fetcher } = fakeFetch([{ match: /tiingo/, body: fixture("tiingo-split.json") }]);
    const market = createMarket({ tiingoKey: "t", fetch: fetcher, today: TODAY });
    const series = await market.dailyBars("AAPL", "2020-08-27", "2020-09-01", { adjust: "total" });
    expect(series.warnings).toContain("Prices include reinvested dividends (total return).");
  });
});

describe("fred and ratios", () => {
  it("parses FRED CSV and skips missing values", () => {
    expect(parseFredCsv(fixture("fred-copper.csv"), "PCOPPUSDM").map((bar) => bar.c)).toEqual([8344.1, 8309.2, 9461.6]);
    expect(() => parseFredCsv("<html>", "NOPE")).toThrow(/no series/);
  });

  it("charts FRED with no key", async () => {
    const { fetcher, calls } = fakeFetch([{ match: /fredgraph\.csv/, body: fixture("fred-copper.csv") }]);
    const series = await createMarket({ fetch: fetcher, today: TODAY }).dailyBars("FRED:PCOPPUSDM", "2024-01-01", "2024-04-01");
    expect(series.source).toBe("FRED");
    expect(series.unit).toBe("");
    expect(calls[0]).toContain("id=PCOPPUSDM&cosd=2024-01-01&coed=2024-04-01");
  });

  it("divides two series on shared dates", () => {
    const a = [1, 2, 3].map((day) => ({ t: day * 86_400_000, o: 0, h: 0, l: 0, c: day * 10 }));
    const b = [2, 3].map((day) => ({ t: day * 86_400_000, o: 0, h: 0, l: 0, c: 5 }));
    expect(ratioBars(a, b).map((bar) => bar.c)).toEqual([4, 6]);
  });
});

describe("csv", () => {
  it("reads date,close with a header and loose number formats", () => {
    const parsed = parseBarsCsv('Date,Open,High,Low,Close\n2024-01-03,"1,000",1100,990,"$1,050.50"\n01/04/2024,1050,1080,1000,1075\nbad,row\n');
    expect(parsed.bars.map((bar) => bar.c)).toEqual([1050.5, 1075]);
    expect(parsed.bars[0]?.o).toBe(1000);
    expect(parsed.skipped).toBe(1);
  });

  it("reads headerless two-column data and sorts it", () => {
    const parsed = parseBarsCsv("2024-02\t5\n2024-01\t4\n");
    expect(parsed.bars.map((bar) => bar.c)).toEqual([4, 5]);
  });

  it("rejects data without two dated numbers", () => {
    expect(() => parseBarsCsv("date,close\n2024-01-01,abc\n")).toThrow(MarketError);
  });
});

describe("helpers", () => {
  it("resamples to month buckets stamped with the last day", () => {
    const days = ["2024-01-02", "2024-01-31", "2024-02-01", "2024-02-29"].map((iso, index) => ({
      t: Date.parse(`${iso}T00:00:00Z`),
      o: index,
      h: index + 1,
      l: index - 1,
      c: index + 0.5,
    }));
    const months = resample(days, "month");
    expect(months).toHaveLength(2);
    expect(months[0]).toMatchObject({ o: 0, h: 2, l: -1, c: 1.5, t: Date.parse("2024-01-31T00:00:00Z") });
  });

  it("turns period chips into ranges", () => {
    expect(periodRange("1Y", "2026-11-14")).toEqual({ from: "2025-11-14", to: "2026-11-14" });
    expect(periodRange("YTD", "2026-11-14")).toEqual({ from: "2026-01-01", to: "2026-11-14" });
    expect(periodRange("6M", "2026-11-14").from).toBe("2026-05-14");
  });

  it("cleans legal suffixes from company names", () => {
    expect(cleanCompanyName("Advanced Micro Devices, Inc.")).toBe("Advanced Micro Devices");
    expect(cleanCompanyName("Alphabet Inc. Class A Common Stock")).toBe("Alphabet");
  });
});
