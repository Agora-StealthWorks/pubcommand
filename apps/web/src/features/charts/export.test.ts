import { describe, expect, it } from "vitest";
import { renderChartSvg } from "../../../../../modules/charts/render";
import { normalizeSpec } from "../../../../../modules/charts/spec";
import { defaultSpec } from "../../../../../modules/charts/templates";
import { embedSvgFonts, glyphsByWeight, pdfFontFamilies, svgToPdf } from "./export";

const DAY = 86_400_000;
const bars = Array.from({ length: 60 }, (_v, i) => {
  const c = 20 + i * 0.5 + Math.sin(i / 3);
  return { t: Date.UTC(2025, 0, 1) + i * DAY, o: c - 0.3, h: c + 0.6, l: c - 0.8, c };
});
const meta = { ticker: "AMD", name: "Advanced Micro Devices", source: "Test data", unit: "$" };

function chartSvg(chartType: "area" | "candle" = "area") {
  const spec = normalizeSpec({ ...defaultSpec("2025-03-01"), chartType, size: { preset: "social" } }, "2025-03-01");
  return { spec, svg: renderChartSvg({ spec, bars, meta }) };
}

describe("vector PDF / AI export", () => {
  it("writes a valid one-page PDF with vector paths and embedded Inter", async () => {
    const { spec, svg } = chartSvg();
    const pdf = await svgToPdf(svg, spec.size.w, spec.size.h, { title: "AMD" });
    const text = pdf.toString("latin1");
    expect(text.startsWith("%PDF-1.5")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toMatch(/\/Type \/Page\b/);
    expect(text.match(/\/Type \/Page\b/g)).toHaveLength(1);
    // 1px = 0.75pt: 1200×628 → 900×471.
    expect(text).toMatch(/\/MediaBox \[0 0 900 471/);
    // Fonts are embedded (subset), not referenced.
    expect(text).toMatch(/\/FontFile3|\/FontFile2/);
    expect(text).toMatch(/Inter/);
    expect(text).not.toMatch(/\/Subtype \/Image/);
    // A cross-reference table that points at real objects.
    const startxref = Number(/startxref\s+(\d+)/.exec(text)?.[1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
  });

  it("draws candles as vector too (the AI file is the same PDF)", async () => {
    const { spec, svg } = chartSvg("candle");
    const ai = await svgToPdf(svg, spec.size.w, spec.size.h, { ai: true });
    expect(ai.subarray(0, 5).toString()).toBe("%PDF-");
    expect(ai.length).toBeGreaterThan(5000);
  });

  it("maps each font weight to its own PDF family", () => {
    expect(pdfFontFamilies('<text font-family="Inter, Arial" font-size="30" font-weight="800">X</text>')).toBe('<text font-family="Inter-800" font-size="30" font-weight="800">X</text>');
  });
});

describe("SVG with embedded fonts", () => {
  it("collects the glyphs per weight and embeds subset WOFF2 faces", async () => {
    const { svg } = chartSvg();
    const glyphs = glyphsByWeight(svg);
    expect([...glyphs.keys()].sort()).toEqual(expect.arrayContaining(["800"]));
    expect(glyphs.get("800")).toContain("A");
    const embedded = await embedSvgFonts(svg);
    expect(embedded).toContain("@font-face{font-family:Inter;font-weight:800;src:url(data:font/woff2;base64,");
    // Subset, not the 600 KB originals.
    expect(embedded.length - svg.length).toBeLessThan(200_000);
    expect(embedded.startsWith("<svg")).toBe(true);
  });
});
