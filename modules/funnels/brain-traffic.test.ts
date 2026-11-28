import { describe, expect, it } from "vitest";
import { funnelTrafficText, safeParamValue, type FunnelTrafficRow } from "./brain-traffic";

const row = (overrides: Partial<FunnelTrafficRow> = {}): FunnelTrafficRow => ({
  organization: "Example Gazette",
  funnel: "Gold Docuseries",
  siteType: "launch",
  visitors: 200,
  views: 640,
  optins: 50,
  offerClickers: 12,
  devices: { mobile: 150, desktop: 50 },
  reach: [
    { position: 2, visitors: 90 },
    { position: 1, visitors: 180 },
  ],
  params: [
    { key: "utm_source", value: "email", visitors: 120, optins: 40 },
    { key: "utm_source", value: "fb", visitors: 80, optins: 10 },
  ],
  ...overrides,
});

describe("funnel traffic for the Brain", () => {
  it("summarizes visitors, conversion, devices, episode reach and sources", () => {
    const text = funnelTrafficText([row()]);
    expect(text).toContain("All funnels: 200 visitors, 50 opt-ins (25%)");
    expect(text).toContain("Devices: mobile 75%, desktop 25%");
    expect(text).toContain("Reach by module: #1 180 (100%) → #2 90 (50%)");
    expect(text).toContain("By utm_source: email 120 visitors / 40 opt-ins (33%); fb 80 visitors / 10 opt-ins (13%)");
  });

  it("never passes on parameter values that look like a person", () => {
    expect(safeParamValue("someone@example.com")).toBeNull();
    expect(safeParamValue("+1 (555) 123-4567")).toBeNull();
    expect(safeParamValue("spring_2026")).toBe("spring_2026");
    const text = funnelTrafficText([row({ params: [{ key: "utm_content", value: "jane@example.com", visitors: 1, optins: 1 }] })]);
    expect(text).not.toContain("@");
  });

  it("is empty when no funnel had traffic, and sorts busiest first", () => {
    expect(funnelTrafficText([row({ visitors: 0, optins: 0 })])).toBe("");
    const text = funnelTrafficText([row({ funnel: "Small", visitors: 5 }), row({ funnel: "Big", visitors: 500 })]);
    expect(text.indexOf("Big")).toBeLessThan(text.indexOf("Small"));
  });
});
