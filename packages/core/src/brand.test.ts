import { describe, expect, it } from "vitest";
import { brandProfile, brandPromptContext } from "./brand";

describe("brandProfile", () => {
  it("defaults unknown niches to general", () => {
    expect(brandProfile({ name: "X", niche: "crypto" }).niche).toBe("general");
  });
  it("uses niche defaults and appends custom rules", () => {
    const health = brandProfile({ name: "Vital", niche: "health", complianceNotes: "- No CBD claims\n\nMention FDA disclaimer" });
    expect(health.audience).toMatch(/Health-conscious/);
    expect(health.complianceRules.some((rule) => rule.includes("diagnoses, treats, cures"))).toBe(true);
    expect(health.complianceRules.slice(-2)).toEqual(["No CBD claims", "Mention FDA disclaimer"]);
  });
  it("prefers the brand's own audience", () => {
    expect(brandProfile({ name: "MTA", niche: "finance", audience: "Options traders" }).audience).toBe("Options traders");
  });
  it("renders a prompt block", () => {
    expect(brandPromptContext(brandProfile({ name: "MTA", niche: "finance" }))).toContain("No guaranteed returns");
  });
});
