import { describe, expect, it } from "vitest";
import { BULK_MAX_ROWS, mapLimit, parseBulkRows } from "./bulk";
import { manifest } from "./manifest";
import { barIndex, dateTicks, formatTick, measureText, niceTicks, renderChart, scaleFactor } from "./render";
import { SIZE_PRESETS, applyStyle, normalizeSpec, safeColor, styleOf } from "./spec";
import { STARTER_TEMPLATES, defaultSpec } from "./templates";
import {
  claimPattern,
  computeStats,
  displayText,
  fmtPct,
  fmtPctRoundedDown,
  isOverridden,
  literalFigures,
  lossify,
  roundDownSig,
  spanText,
  tokenValues,
  type ChartBar,
} from "./tokens";

const DAY = 86_400_000;
const bar = (iso: string, c: number): ChartBar => ({ t: Date.parse(`${iso}T00:00:00Z`), o: c, h: c, l: c, c });

function series(from: string, days: number, start: number, end: number): ChartBar[] {
  const t0 = Date.parse(`${from}T00:00:00Z`);
  return Array.from({ length: days }, (_v, i) => {
    const c = start + ((end - start) * i) / (days - 1);
    return { t: t0 + i * DAY, o: c, h: c * 1.01, l: c * 0.99, c };
  });
}

describe("token math", () => {
  it("computes gain and CAGR from first and last close", () => {
    const stats = computeStats([bar("2016-01-04", 10), bar("2021-01-04", 20), bar("2026-01-05", 40)]);
    expect(stats?.gainPct).toBeCloseTo(300, 9);
    expect(stats?.years).toBeCloseTo(10, 1);
    // 4x in ten years = 14.87% a year
    expect(stats?.cagrPct).toBeCloseTo((Math.pow(4, 1 / stats!.years) - 1) * 100, 9);
    expect(stats?.cagrPct).toBeCloseTo(14.87, 1);
  });

  it("leaves CAGR blank for less than a year", () => {
    expect(computeStats([bar("2026-01-02", 10), bar("2026-06-01", 12)])?.cagrPct).toBeNull();
  });

  it("rounds the gain DOWN to two significant figures, never up", () => {
    expect(roundDownSig(347.9)).toBe(340);
    expect(roundDownSig(24_812)).toBe(24_000);
    expect(roundDownSig(9.87)).toBe(9.8);
    expect(roundDownSig(0.29)).toBe(0.29);
    expect(roundDownSig(199.99)).toBe(190);
    expect(roundDownSig(-12.6)).toBe(-12);
    expect(fmtPctRoundedDown(1_234.5)).toBe("1,200%");
    expect(fmtPctRoundedDown(9.87)).toBe("9.8%");
  });

  it("formats tokens from real closes", () => {
    const stats = computeStats([bar("2024-01-02", 12.5), bar("2025-01-02", 56.25)]);
    const tokens = tokenValues(stats, { ticker: "AMD", name: "Advanced Micro Devices", source: "Massive", unit: "$" });
    expect(tokens).toMatchObject({ gain: "350%", gainRounded: "350%", start: "$12.50", end: "$56.25", ticker: "AMD", years: "1" });
    expect(tokens.cagr).toBe("349%");
    expect(displayText("{ticker} UP {gain}", tokens, stats?.gainPct)).toBe("AMD UP 350%");
  });

  it("describes the span in words", () => {
    expect(spanText(0.5)).toBe("6 months");
    expect(spanText(1.02)).toBe("1 year");
    expect(spanText(4.9)).toBe("5 years");
  });

  it("never prints -0% and reads a loss as a loss", () => {
    expect(fmtPct(-0.2)).toBe("0%");
    expect(lossify("{gain} gain", -12)).toBe("{gainAbs} loss");
    const stats = computeStats([bar("2024-01-02", 100), bar("2024-06-03", 88)]);
    const tokens = tokenValues(stats, { ticker: "X", name: "X", source: "s", unit: "$" });
    expect(displayText("A {gain} GAIN", tokens, stats?.gainPct)).toBe("A 12% LOSS");
    expect(displayText("A {gain} gain", tokens, stats?.gainPct, false)).toBe("A -12% gain");
  });

  it("detects typed figures as an override", () => {
    expect(isOverridden("UP {gain}")).toBe(false);
    expect(isOverridden("UP 500%")).toBe(true);
    expect(literalFigures("Turned $1,000 into {end} — up 1,200 %")).toEqual(["$1,000", "1,200 %"]);
    expect(isOverridden("{ticker} in 2024")).toBe(false);
    expect(claimPattern("{ticker} UP {gainRounded}")).toBe("TICKER UP N%+");
  });
});

describe("spec", () => {
  it("only accepts safe colors", () => {
    expect(safeColor("#abc", "#000")).toBe("#abc");
    expect(safeColor("rgba(1,2,3,0.5)", "#000")).toBe("rgba(1,2,3,0.5)");
    expect(safeColor('red" onload="x', "#000")).toBe("#000");
    expect(safeColor("url(#x)", "#000")).toBe("#000");
  });

  it("clamps, drops unknown overlays and keeps preset sizes", () => {
    const spec = normalizeSpec(
      {
        size: { preset: "story", w: 1, h: 1 },
        overlays: [{ type: "headline", x: 99, text: "x".repeat(900) }, { type: "script" }, { type: "image", assetId: "not-a-uuid" }],
        data: { symbol: "AMD", period: "5Y", interval: "nope" },
      },
      "2026-11-14",
    );
    expect(spec.size).toEqual({ preset: "story", w: 1080, h: 1920 });
    expect(spec.overlays).toHaveLength(1);
    expect(spec.overlays[0]).toMatchObject({ type: "headline", x: 1.5 });
    expect((spec.overlays[0] as { text: string }).text).toHaveLength(400);
    expect(spec.data).toMatchObject({ symbol: "AMD", period: "5Y", interval: "day", adjust: "split" });
  });

  it("applies a template but keeps the data, title and typed headline", () => {
    const base = defaultSpec("2026-11-14");
    base.data.symbol = "NVDA";
    base.title = "Mine";
    const head = base.overlays.find((o) => o.type === "headline");
    if (head && head.type === "headline") head.text = "UP 900%";
    const next = applyStyle(base, STARTER_TEMPLATES[2]!.style, "t");
    expect(next.data.symbol).toBe("NVDA");
    expect(next.title).toBe("Mine");
    expect(next.theme.background).toBe("#ffffff");
    expect(styleOf(next).design).toEqual({ w: 2000, h: 1000 });
  });
});

describe("renderer", () => {
  const bars = series("2024-01-02", 260, 50, 150);
  const meta = { ticker: "TEST", name: "Test Co", source: "Fixture", unit: "$" };

  it("is pure: the same input gives the same SVG", () => {
    const spec = defaultSpec("2026-11-14");
    const a = renderChart({ spec, bars, meta }).svg;
    const b = renderChart({ spec: structuredClone(spec), bars: bars.map((x) => ({ ...x })), meta }).svg;
    expect(a).toBe(b);
  });

  it("draws the headline from the data, the source footer and overlay hooks", () => {
    const spec = defaultSpec("2026-11-14");
    const { svg, tokens } = renderChart({ spec, bars, meta });
    expect(tokens.gain).toBe("200%");
    expect(svg).toContain(">TEST UP 200%<");
    expect(svg).toContain("Source: Fixture.");
    expect(svg).toContain('data-overlay-id="headline"');
    expect(svg).toContain('data-overlay-type="arrow"');
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="2000" height="1000"/);
  });

  it("escapes every text it draws", () => {
    const spec = normalizeSpec({ ...defaultSpec("2026-11-14"), title: '<script>alert(1)</script>"&' }, "2026-11-14");
    const { svg } = renderChart({ spec, bars, meta: { ...meta, name: "<b>" } });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;SCRIPT&gt;".toLowerCase().replace("script", "script"));
    expect(svg).toContain("&quot;&amp;");
  });

  it("renders every starter at every size", () => {
    for (const template of STARTER_TEMPLATES) {
      for (const preset of Object.keys(SIZE_PRESETS) as Array<keyof typeof SIZE_PRESETS>) {
        const spec = applyStyle({ ...defaultSpec("2026-11-14"), size: { preset, ...SIZE_PRESETS[preset] } }, template.style, null);
        const { svg } = renderChart({ spec, bars, meta });
        expect(svg).toContain(`viewBox="0 0 ${SIZE_PRESETS[preset].w} ${SIZE_PRESETS[preset].h}"`);
        expect(svg).not.toMatch(/NaN|Infinity|undefined/);
      }
    }
  });

  it("scales design units to the canvas", () => {
    const spec = defaultSpec("2026-11-14");
    expect(scaleFactor(spec)).toBe(1);
    expect(scaleFactor({ ...spec, size: { preset: "square", w: 1080, h: 1080 } })).toBeCloseTo(Math.min(0.54 * 1.4, Math.sqrt(0.54 * 1.08)), 6);
    expect(scaleFactor({ ...spec, size: { preset: "story", w: 1080, h: 1920 } })).toBeCloseTo(0.54 * 1.4, 6);
  });

  it("draws candles and a placeholder without data", () => {
    const spec = { ...defaultSpec("2026-11-14"), chartType: "candle" as const };
    expect(renderChart({ spec, bars: bars.slice(0, 30), meta }).svg.match(/<rect /g)?.length).toBeGreaterThan(30);
    expect(renderChart({ spec, bars: [], meta }).svg).toContain("No data to chart yet");
  });

  it("places image overlays from the injected href only", () => {
    const spec = normalizeSpec({ ...defaultSpec("2026-11-14"), overlays: [{ type: "image", id: "logo", assetId: "11111111-1111-4111-8111-111111111111", x: 0.8, y: 0.1, w: 0.1, aspect: 2 }] }, "2026-11-14");
    const svg = renderChart({ spec, bars, meta, imageHref: () => "data:image/png;base64,AAAA" }).svg;
    expect(svg).toContain('<image href="data:image/png;base64,AAAA" x="1600" y="100" width="200" height="100"');
  });
});

describe("scales and labels", () => {
  it("picks clean ticks", () => {
    expect(niceTicks(13, 97, 5)).toMatchObject({ lo: 0, hi: 100, step: 25 });
    expect(formatTick(1500, 500, "$")).toBe("$1,500");
    expect(formatTick(0.35, 0.05, "")).toBe("0.35");
  });

  it("labels years for long ranges and months for short ones", () => {
    const long = series("2015-01-02", 365 * 10, 10, 20);
    expect(dateTicks(long, 8).every((tick) => /^\d{4}$/.test(tick.label))).toBe(true);
    const short = series("2026-01-02", 120, 10, 20);
    expect(dateTicks(short, 8).map((tick) => tick.label)).toEqual(["Feb", "Mar", "Apr", "May"]);
  });

  it("finds bars by keyword and date", () => {
    const bars = [bar("2024-01-02", 5), bar("2024-01-03", 9), bar("2024-01-04", 1)];
    expect(barIndex(bars, "high")).toBe(1);
    expect(barIndex(bars, "low")).toBe(2);
    expect(barIndex(bars, "2024-01-03")).toBe(1);
  });

  it("measures text from the bundled font metrics", () => {
    expect(measureText("AAAA", 800, 100)).toBeCloseTo(4 * measureText("A", 800, 100), 6);
    expect(measureText("W", 700, 100)).toBeGreaterThan(measureText("i", 700, 100));
  });
});

describe("bulk rows", () => {
  it("parses tickers, periods, date ranges and timeframes", () => {
    const { rows, errors } = parseBulkRows("ticker,period,title,headline,timeframe\nAAPL,5Y,,UP {gainRounded},weekly\nmsft,2020-01-01..2024-12-31,\"Microsoft, Inc\"\nFRED:DGS10,10Y\n");
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ symbol: "AAPL", period: "5Y", headline: "UP {gainRounded}", interval: "week", title: null });
    expect(rows[1]).toMatchObject({ symbol: "MSFT", period: "CUSTOM", from: "2020-01-01", to: "2024-12-31", title: "Microsoft, Inc" });
    expect(rows[2]?.symbol).toBe("FRED:DGS10");
  });

  it("reports bad rows by line and caps the run", () => {
    expect(parseBulkRows("AAPL,7Q\n<x>,1Y\nAAPL,1Y,,,hourly").errors).toHaveLength(3);
    const many = Array.from({ length: BULK_MAX_ROWS + 5 }, () => "AAPL,1Y").join("\n");
    expect(parseBulkRows(many).errors[0]).toMatch(/up to 100/);
  });

  it("runs at most N at a time and keeps order", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9], 4, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 2));
      running -= 1;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18]);
    expect(peak).toBe(4);
  });
});

describe("charts manifest", () => {
  it("keeps the module id and route", () => {
    expect(manifest.id).toBe("charts");
    expect(manifest.slug).toBe("charts");
    expect(manifest.planEntitlement).toBe("charts");
    expect(manifest.routes.map((route) => route.path)).toEqual(["/charts"]);
    expect(manifest.permissions.map((permission) => permission.key)).toEqual(["charts.read", "charts.write"]);
  });
});
