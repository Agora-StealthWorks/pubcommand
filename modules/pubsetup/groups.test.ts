import { describe, expect, it } from "vitest";
import { FUNNEL_GROUPS, funnelGroup, groupByFunnel, sortByFunnel } from "./groups";
import { PUBLICATION_TIERS, PUBLICATION_TYPES } from "./fields";

describe("funnel grouping", () => {
  it("offers the new type and tier options and keeps the old ones", () => {
    expect(PUBLICATION_TYPES).toContain("Text letter (SMS)");
    expect(PUBLICATION_TYPES).toContain("Alert service");
    expect(PUBLICATION_TYPES).toContain("Free newsletter");
    expect(PUBLICATION_TIERS).toContain("Bonus / complimentary");
    expect(PUBLICATION_TIERS).toContain("Lifetime");
  });

  it("puts text letters and alerts together whatever their tier", () => {
    expect(funnelGroup({ pubType: "Text letter (SMS)", tier: "Front-end" })).toBe("text");
    expect(funnelGroup({ pubType: "Alert service", tier: "High-ticket" })).toBe("text");
  });

  it("puts free newsletters first, by type or by tier", () => {
    expect(funnelGroup({ pubType: "Free newsletter", tier: null })).toBe("free");
    expect(funnelGroup({ pubType: "Paid newsletter", tier: "Free / lead gen" })).toBe("free");
  });

  it("uses the tier for everything else, and Other when there is none", () => {
    expect(funnelGroup({ pubType: "Paid newsletter", tier: "Front-end" })).toBe("front");
    expect(funnelGroup({ pubType: null, tier: "Mid-tier" })).toBe("mid");
    expect(funnelGroup({ pubType: null, tier: "Back-end" })).toBe("back");
    expect(funnelGroup({ pubType: null, tier: "High-ticket" })).toBe("high");
    expect(funnelGroup({ pubType: "Membership", tier: "Lifetime" })).toBe("lifetime");
    expect(funnelGroup({ pubType: null, tier: "Bonus / complimentary" })).toBe("bonus");
    expect(funnelGroup({ pubType: "Course", tier: null })).toBe("other");
    expect(funnelGroup({ pubType: undefined, tier: "Something new" })).toBe("other");
  });

  it("orders groups by funnel position and items by sort order then name", () => {
    const pubs = [
      { name: "Zed Pro", tier: "Back-end", sortOrder: 0 },
      { name: "Unsorted", sortOrder: 0 },
      { name: "beta Daily", pubType: "Free newsletter", sortOrder: 0 },
      { name: "Alpha Daily", pubType: "Free newsletter", sortOrder: 0 },
      { name: "First Free", pubType: "Free newsletter", sortOrder: -1 },
      { name: "Bonus Report", tier: "Bonus / complimentary", sortOrder: 0 },
      { name: "Flash Alerts", pubType: "Alert service", tier: "Mid-tier", sortOrder: 0 },
      { name: "Weekly", tier: "Front-end", sortOrder: 2 },
      { name: "Insider", tier: "Front-end", sortOrder: 1 },
      { name: "Vault", tier: "Lifetime", sortOrder: 0 },
      { name: "Elite", tier: "High-ticket", sortOrder: 0 },
      { name: "Core", tier: "Mid-tier", sortOrder: 0 },
      { name: "SMS Picks", pubType: "Text letter (SMS)", sortOrder: 0 },
    ];
    const groups = groupByFunnel(pubs);
    expect(groups.map((g) => g.label)).toEqual(["Free newsletters", "Text letters & alerts", "Front-end", "Mid-tier", "Back-end", "High-ticket", "Lifetime / bundles", "Bonus / complimentary", "Other"]);
    expect(groups[0]!.items.map((p) => p.name)).toEqual(["First Free", "Alpha Daily", "beta Daily"]);
    expect(groups[1]!.items.map((p) => p.name)).toEqual(["Flash Alerts", "SMS Picks"]);
    expect(groups[2]!.items.map((p) => p.name)).toEqual(["Insider", "Weekly"]);
    expect(sortByFunnel(pubs).at(-1)!.name).toBe("Unsorted");
    expect(FUNNEL_GROUPS.at(-1)!.label).toBe("Other");
  });

  it("leaves out empty groups", () => {
    expect(groupByFunnel([{ name: "A", tier: "Mid-tier" }]).map((g) => g.key)).toEqual(["mid"]);
    expect(groupByFunnel([])).toEqual([]);
  });
});
