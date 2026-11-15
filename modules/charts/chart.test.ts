import { describe, expect, it } from "vitest";
import { EXAMPLE_CSV } from "./example";
import { manifest } from "./manifest";
import { parseCsv } from "./csv";
import { chartShareSearch, createChartShareToken, readChartShare } from "./share";
import { BRAND_ACCENT, normalizeAccent, renderLineChartSvg } from "./svg";

const SECRET = "ci-auth-secret-not-used-in-production";
const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("charts csv", () => {
  it("parses the example CSV", () => {
    const result = parseCsv(EXAMPLE_CSV);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.chart.xLabel).toBe("month");
    expect(result.chart.yLabel).toBe("readers");
    expect(result.chart.points).toHaveLength(6);
    expect(result.chart.points[0]).toEqual({ label: "Jan", value: 1200 });
    expect(result.chart.points[5]).toEqual({ label: "Jun", value: 1580 });
  });

  it("keeps commas inside quoted labels", () => {
    const result = parseCsv('label,value\n"Jan, early",12\n');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.chart.points[0]).toEqual({ label: "Jan, early", value: 12 });
  });

  it("rejects a row that is not numeric", () => {
    const result = parseCsv("month,readers\nJan,many\n");
    expect(result).toEqual({ ok: false, error: '"Jan" is not a number.' });
  });
});

describe("charts svg", () => {
  it("draws the example in the brand accent with an annotation", () => {
    const parsed = parseCsv(EXAMPLE_CSV);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const svg = renderLineChartSvg({
      chart: parsed.chart,
      accent: BRAND_ACCENT,
      annotation: "Readers are up",
    });
    expect(svg).toContain(`stroke="${BRAND_ACCENT}"`);
    expect(svg).toContain("Readers are up");
    expect(svg).toContain(">Jan<");
    expect(svg).toContain(">Jun<");
  });

  it("escapes labels and falls back when the accent is not a hex color", () => {
    const parsed = parseCsv("month,readers\n</svg><script>,10\n");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const svg = renderLineChartSvg({
      chart: parsed.chart,
      accent: `${BRAND_ACCENT}"><script>`,
      annotation: "<script>",
    });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain(`stroke="${BRAND_ACCENT}"`);
    expect(normalizeAccent("#abc")).toBe("#aabbcc");
  });
});

describe("charts share token", () => {
  const draft = { csv: EXAMPLE_CSV, annotation: "Desk copy", accent: "#abc" };

  it("round-trips a token for the same organization", () => {
    const signed = createChartShareToken(draft, ORG, SECRET);
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    expect(chartShareSearch(signed.token).startsWith("?share=")).toBe(true);
    const opened = readChartShare(signed.token, SECRET, ORG);
    expect(opened?.organizationId).toBe(ORG);
    expect(opened?.annotation).toBe("Desk copy");
    expect(opened?.accent).toBe("#aabbcc");
    expect(opened?.csv).toBe(EXAMPLE_CSV);
  });

  it("rejects a token opened by another organization", () => {
    const signed = createChartShareToken(draft, ORG, SECRET);
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    expect(readChartShare(signed.token, SECRET, OTHER)).toBeNull();
  });

  it("rejects a tampered token and an invalid CSV", () => {
    const signed = createChartShareToken(draft, ORG, SECRET);
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    const dot = signed.token.indexOf(".");
    const body = signed.token.slice(0, dot);
    const signature = signed.token.slice(dot + 1);
    const flipped = `${signature.slice(0, -1)}${signature.endsWith("a") ? "b" : "a"}`;
    expect(readChartShare(`${body}.${flipped}`, SECRET, ORG)).toBeNull();
    expect(createChartShareToken({ ...draft, csv: "only-a-header" }, ORG, SECRET)).toEqual({
      ok: false,
      error: "CSV needs a header and at least one row.",
    });
  });
});

describe("charts manifest", () => {
  it("matches the module contract", () => {
    expect(manifest.id).toBe("charts");
    expect(manifest.slug).toBe("charts");
    expect(manifest.planEntitlement).toBe("charts");
    expect(manifest.routes).toEqual([{ path: "/charts", title: "Charts" }]);
    expect(manifest.permissions.map((permission) => permission.key)).toEqual(["charts.read", "charts.write"]);
  });
});
