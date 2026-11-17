import { describe, expect, it } from "vitest";
import { ALL_SCOPES, bearerKey, clampRateLimit, generateApiKey, generateFileToken, hasScope, hashApiKey, isFileToken, keyMatches, normalizeScopes, rateDecision } from "./api-keys";
import { autoInterval, botBulkRows, botSpec } from "./bot";
import { alignToMain, compareLines, compareTick, rebaseBars, rebaseValues } from "./compare";
import { directionRuns, extendedRuns, isExtendedBar, renderChart } from "./render";
import { normalizeData, normalizeSpec, normalizeStyle } from "./spec";
import { STARTER_TEMPLATES, defaultSpec } from "./templates";
import type { ChartBar } from "./tokens";

const DAY = 86_400_000;
const T0 = Date.parse("2025-01-01T00:00:00Z");
const bars = (closes: number[], step = DAY, t0 = T0): ChartBar[] => closes.map((c, i) => ({ t: t0 + i * step, o: c, h: c, l: c, c }));
const meta = { ticker: "AAA", name: "Alpha", source: "test", unit: "$" };

describe("compare rebasing", () => {
  it("aligns another series to the main dates, carrying the last close forward", () => {
    const main = bars([10, 11, 12, 13]);
    // Other series misses day 2 (a holiday) and starts a day late.
    const other: ChartBar[] = [
      { t: T0 + DAY, o: 0, h: 0, l: 0, c: 50 },
      { t: T0 + 3 * DAY, o: 0, h: 0, l: 0, c: 60 },
    ];
    expect(alignToMain(main, other)).toEqual([null, 50, 50, 60]);
  });

  it("rebases to 100 or to % change from each line's own first value", () => {
    expect(rebaseValues([null, 50, 75, 100], "rebase")).toEqual([null, 100, 150, 200]);
    expect(rebaseValues([20, 25, 10], "pct")).toEqual([0, 25, -50]);
    expect(rebaseBars(bars([4, 6, 2]), "pct").map((bar) => bar.c)).toEqual([0, 50, -50]);
    expect(rebaseBars(bars([4, 6]), "rebase").map((bar) => bar.c)).toEqual([100, 150]);
  });

  it("computes each compare line's gain from its own closes over the main range", () => {
    const main = bars([100, 110, 120]);
    const other = bars([40, 42, 44, 50, 60], DAY, T0 - DAY);
    const [line] = compareLines(main, [{ symbol: "SPY", label: "", color: "#f97316", bars: other }], "pct");
    // Window = the bar at/before main start (T0 → 42) to the main end (T0+2d → 50).
    expect(line?.stats?.first).toBe(42);
    expect(line?.stats?.last).toBe(50);
    expect(line?.label).toBe("SPY");
    expect(line?.values).toEqual([0, (44 / 42 - 1) * 100, (50 / 42 - 1) * 100]);
  });

  it("labels a % axis with signs and a rebased axis plainly", () => {
    expect(compareTick(25, 25, "pct")).toBe("+25%");
    expect(compareTick(-10, 5, "pct")).toBe("-10%");
    expect(compareTick(0, 5, "pct")).toBe("0%");
    expect(compareTick(150, 50, "rebase")).toBe("150");
  });

  it("draws every line rebased with a legend, while tokens stay raw", () => {
    const spec = normalizeSpec({ ...defaultSpec("2025-02-01"), chartType: "area", data: { symbol: "AAA", compare: ["SPY", { symbol: "QQQ", label: "Nasdaq" }], compareMode: "pct" } }, "2025-02-01");
    const main = bars([10, 15, 20]);
    const result = renderChart({
      spec,
      bars: main,
      meta,
      compare: [
        { symbol: "SPY", label: "", color: "#f97316", bars: bars([400, 410, 440]) },
        { symbol: "QQQ", label: "Nasdaq", color: "#a855f7", bars: bars([300, 270, 330]) },
      ],
    });
    expect(result.tokens.gain).toBe("100%");
    expect(result.tokens.gain2).toBe("10%");
    expect(result.tokens.name3).toBe("Nasdaq");
    expect(result.svg).toContain('data-compare="SPY"');
    expect(result.svg).toContain("Nasdaq +10%");
    expect(result.svg).toMatch(/>\+100%</);
    // The axis is % change: the main line's y for its last bar maps to +100%.
    expect(result.layout.y(100)).toBeLessThan(result.layout.y(0));
  });

  it("ignores compare lines in the spec when their bars were not loaded", () => {
    const spec = normalizeSpec({ ...defaultSpec("2025-02-01"), data: { symbol: "AAA", compare: ["SPY"] } }, "2025-02-01");
    const result = renderChart({ spec, bars: bars([10, 15, 20]), meta });
    expect(result.svg).not.toContain("data-compare");
    expect(result.compare).toEqual([]);
  });

  it("normalizes compare lines: max 4, no duplicates, no CSV, safe colors", () => {
    const data = normalizeData({ compare: ["spy", "SPY", "csv", "QQQ", { symbol: "IWM", color: "javascript:x" }, "DIA", "GLD"] }, "2025-01-01");
    expect(data.compare.map((line) => line.symbol)).toEqual(["spy", "QQQ", "IWM", "DIA"]);
    expect(data.compare[2]?.color).toMatch(/^#/);
    expect(normalizeData({}, "2025-01-01")).toMatchObject({ compare: [], compareMode: "pct", extended: false });
  });
});

describe("candles and OHLC", () => {
  const ohlc: ChartBar[] = [
    { t: T0, o: 10, h: 12, l: 9, c: 11 },
    { t: T0 + DAY, o: 11, h: 11.5, l: 8, c: 9 },
    { t: T0 + 2 * DAY, o: 9, h: 13, l: 9, c: 12.5 },
  ];
  it("draws a candle per bar, colored by direction, and fits the axis to highs and lows", () => {
    const spec = { ...defaultSpec("2025-02-01"), chartType: "candle" as const };
    const result = renderChart({ spec, bars: ohlc, meta });
    expect(result.svg.match(/data-candle="up"/g)).toHaveLength(2);
    expect(result.svg.match(/data-candle="down"/g)).toHaveLength(1);
    expect(result.svg).toContain(`fill="${spec.theme.candle.down}"`);
    expect(result.layout.yMin).toBeLessThanOrEqual(8);
    expect(result.layout.yMax).toBeGreaterThanOrEqual(13);
  });

  it("draws OHLC bars: range, open tick left, close tick right", () => {
    const spec = normalizeSpec({ ...defaultSpec("2025-02-01"), chartType: "ohlc" }, "2025-02-01");
    expect(spec.chartType).toBe("ohlc");
    const result = renderChart({ spec, bars: ohlc, meta });
    const paths = [...result.svg.matchAll(/<path data-ohlc="(up|down)" d="M([\d.]+) ([\d.]+)V([\d.]+)M([\d.]+) [\d.]+H([\d.]+)M[\d.]+ [\d.]+H([\d.]+)"/g)];
    expect(paths.map((m) => m[1])).toEqual(["up", "down", "up"]);
    const [, , x, yHigh, yLow, openX, openEnd, closeEnd] = paths[0]!.map(Number);
    expect(yHigh).toBeLessThan(yLow!);
    expect(openX).toBeLessThan(x!);
    expect(openEnd).toBeCloseTo(x!, 1);
    expect(closeEnd).toBeGreaterThan(x!);
  });

  it("falls back to lines in compare mode", () => {
    const spec = normalizeSpec({ ...defaultSpec("2025-02-01"), chartType: "candle", data: { symbol: "AAA", compare: ["SPY"] } }, "2025-02-01");
    const result = renderChart({ spec, bars: ohlc, meta, compare: [{ symbol: "SPY", label: "", color: "#f97316", bars: ohlc }] });
    expect(result.svg).not.toContain("data-candle");
  });
});

describe("performance coloring", () => {
  it("groups steps into up/down runs", () => {
    expect(directionRuns([1, 2, 3, 2, 1, 4])).toEqual([
      [0, 2, true],
      [2, 4, false],
      [4, 5, true],
    ]);
  });

  it("colors segments by direction and the whole line by the total move", () => {
    const base = defaultSpec("2025-02-01");
    const seg = renderChart({ spec: { ...base, perfColors: "segments" }, bars: bars([1, 2, 3, 2, 1, 4]), meta });
    expect(seg.svg.match(/data-perf="up"/g)).toHaveLength(2);
    expect(seg.svg.match(/data-perf="down"/g)).toHaveLength(1);
    const down = renderChart({ spec: { ...base, chartType: "line", perfColors: "overall" }, bars: bars([10, 12, 8]), meta });
    expect(down.svg).toContain(`stroke="${base.theme.candle.down}"`);
    expect(normalizeStyle({}).perfColors).toBe("off");
    // Old template rows without the field keep working.
    expect(normalizeStyle(STARTER_TEMPLATES[0]!.style).perfColors).toBe("off");
  });
});

describe("extended hours", () => {
  it("knows the regular New York session for 5-minute and hourly bars", () => {
    expect(isExtendedBar(Date.parse("2025-03-03T14:30:00Z"), "5min")).toBe(false); // 9:30 ET
    expect(isExtendedBar(Date.parse("2025-03-03T14:25:00Z"), "5min")).toBe(true); // 9:25 ET
    expect(isExtendedBar(Date.parse("2025-03-03T21:00:00Z"), "5min")).toBe(true); // 16:00 ET
    expect(isExtendedBar(Date.parse("2025-03-03T14:00:00Z"), "hour")).toBe(false); // 9:00 ET bar holds the open
    expect(isExtendedBar(Date.parse("2025-03-03T13:00:00Z"), "hour")).toBe(true); // 8:00 ET
  });

  it("shades only when extended hours are on", () => {
    const hourly = bars([1, 2, 3, 4, 5, 6], 3_600_000, Date.parse("2025-03-03T12:00:00Z")); // 7:00-12:00 ET
    expect(extendedRuns(hourly, "hour")).toEqual([[0, 1]]);
    const base = normalizeSpec({ ...defaultSpec("2025-03-04"), data: { symbol: "AAA", interval: "hour", extended: true } }, "2025-03-04");
    expect(renderChart({ spec: base, bars: hourly, meta }).svg).toContain('data-extended="1"');
    expect(renderChart({ spec: { ...base, data: { ...base.data, extended: false } }, bars: hourly, meta }).svg).not.toContain("data-extended");
  });
});

describe("api keys", () => {
  it("makes long random keys and stores only a SHA-256", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.key).toMatch(/^pcc_[A-Za-z0-9_-]{43}$/);
    expect(a.key).not.toBe(b.key);
    expect(a.hash).toBe(hashApiKey(a.key));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).not.toContain(a.key.slice(4, 20));
    expect(a.prefix).toBe(a.key.slice(0, 12));
    expect(keyMatches(a.key, a.hash)).toBe(true);
    expect(keyMatches(b.key, a.hash)).toBe(false);
  });

  it("reads Bearer or x-api-key and rejects anything malformed", () => {
    const { key } = generateApiKey();
    const headers = (entries: Record<string, string>) => ({ get: (name: string) => entries[name] ?? null });
    expect(bearerKey(headers({ authorization: `Bearer ${key}` }))).toBe(key);
    expect(bearerKey(headers({ "x-api-key": key }))).toBe(key);
    expect(bearerKey(headers({ authorization: "Bearer nope" }))).toBeNull();
    expect(bearerKey(headers({ authorization: `Basic ${key}` }))).toBeNull();
    expect(bearerKey(headers({}))).toBeNull();
  });

  it("keeps only known scopes and checks them", () => {
    expect(normalizeScopes(["charts.bulk", "admin", "charts.render", "charts.render", 3])).toEqual(["charts.render", "charts.bulk"]);
    expect(hasScope(["charts.render"], "charts.render")).toBe(true);
    expect(hasScope(["charts.render"], "charts.bulk")).toBe(false);
    expect(ALL_SCOPES).toHaveLength(4);
  });

  it("rate-limits on a rolling window", () => {
    expect(rateDecision(0, 2)).toMatchObject({ allowed: true, remaining: 1 });
    expect(rateDecision(1, 2)).toMatchObject({ allowed: true, remaining: 0 });
    expect(rateDecision(2, 2)).toMatchObject({ allowed: false, remaining: 0, retryAfterSeconds: 60 });
    expect(clampRateLimit("9999")).toBe(600);
    expect(clampRateLimit("x")).toBe(60);
  });

  it("makes 144-bit file tokens", () => {
    const token = generateFileToken();
    expect(isFileToken(token)).toBe(true);
    expect(Buffer.from(token, "base64url")).toHaveLength(18);
    expect(isFileToken("../etc/passwd")).toBe(false);
  });
});

describe("bot requests", () => {
  const style = STARTER_TEMPLATES[0]!.style;
  const TEMPLATE_ID = "6f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7";
  it("lays a short request over the template", () => {
    const result = botSpec({ ticker: "nvda", period: "10y", size: "social", headline: "{gainRounded}\\nIN 10 YEARS", compare: ["SPY"], extendedHours: true, perfColors: true }, style, TEMPLATE_ID, "2026-11-14");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.data).toMatchObject({ symbol: "nvda", period: "10Y", interval: "month", extended: true });
    expect(result.spec.data.compare.map((line) => line.symbol)).toEqual(["SPY"]);
    expect(result.spec.size).toMatchObject({ preset: "social", w: 1200, h: 628 });
    expect(result.spec.perfColors).toBe("overall");
    expect(result.spec.templateId).toBe(TEMPLATE_ID);
    expect(result.spec.overlays.find((o) => o.type === "headline")).toMatchObject({ text: "{gainRounded}\nIN 10 YEARS" });
  });

  it("names the bad field", () => {
    expect(botSpec({}, style, null, "2026-11-14")).toMatchObject({ ok: false, field: "ticker" });
    expect(botSpec({ ticker: "AMD", period: "7Y" }, style, null, "2026-11-14")).toMatchObject({ ok: false, field: "period" });
    expect(botSpec({ ticker: "AMD", from: "2020-01-01", to: "2019-01-01" }, style, null, "2026-11-14")).toMatchObject({ ok: false, field: "from" });
    expect(botSpec({ ticker: "AMD", chartType: "pie" }, style, null, "2026-11-14")).toMatchObject({ ok: false, field: "chartType" });
    expect(botSpec({ ticker: "AMD", size: "huge" }, style, null, "2026-11-14")).toMatchObject({ ok: false, field: "size" });
  });

  it("picks the timeframe from the span", () => {
    expect(autoInterval("1Y", null, null)).toBe("day");
    expect(autoInterval("5Y", null, null)).toBe("week");
    expect(autoInterval("CUSTOM", "2005-01-01", "2026-01-01")).toBe("month");
  });

  it("accepts a full spec and bulk rows with defaults", () => {
    const full = botSpec({ spec: { ...defaultSpec("2026-11-14"), chartType: "ohlc" } }, null, null, "2026-11-14");
    expect(full.ok && full.spec.chartType).toBe("ohlc");
    const bulk = botBulkRows({ template: "x", defaults: { interval: "month" }, rows: [{ ticker: "AMD" }, { ticker: "NVDA", interval: "week" }] });
    expect(bulk.rows.map((row) => row.body)).toEqual([
      { interval: "month", template: "x", size: undefined, ticker: "AMD" },
      { interval: "week", template: "x", size: undefined, ticker: "NVDA" },
    ]);
    expect(botBulkRows({ rows: [] }).errors).toHaveLength(1);
  });
});
