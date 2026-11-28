/** Docuseries additions: the offer blocks, locked teasers, the header bar target and presets. */
import { describe, expect, it } from "vitest";
import { lines, normalizeBlock, normalizeBlocks, parseBonus, normalizeTarget } from "./blocks";
import { deadlineBar, deadlineButtonHref, normalizeDeadlineButtonUrl } from "./deadline";
import { linkItems, linkItemsFromForm } from "./links";
import { FUNNEL_PRESETS, presetBasics, presetColumns, presetDayResources, presetOfferBlocks } from "./presets";
import type { FunnelRules } from "./state";

describe("offer blocks", () => {
  it("cleans a pricing block: caps tiers, drops bad links, keeps lines", () => {
    const block = normalizeBlock({
      type: "pricing",
      heading: "Pick one",
      tiers: [
        { name: "Basic", price: "$97", features: "A\nB", bonuses: "Cookbook | $36\nCall", buttonText: "Buy", url: "https://shop.example/basic", highlight: false },
        { name: "Gold", price: "$197", url: "javascript:alert(1)", highlight: true },
        { name: "C" },
        { name: "D" },
      ],
    });
    expect(block?.type).toBe("pricing");
    if (block?.type !== "pricing") return;
    expect(block.tiers).toHaveLength(3);
    expect(block.tiers[0]!.url).toBe("https://shop.example/basic");
    expect(block.tiers[1]!.url).toBe("");
    expect(lines(block.tiers[0]!.features)).toEqual(["A", "B"]);
    expect(parseBonus("Cookbook | $36")).toEqual({ name: "Cookbook", value: "$36" });
    expect(parseBonus("Call")).toEqual({ name: "Call", value: "" });
  });

  it("testimonials clamp the rating; logos need https; faq and episodes keep their fields", () => {
    const [t, l, f, e] = normalizeBlocks([
      { type: "testimonials", items: [{ quote: "Great", name: "A", rating: 9 }, "junk"] },
      { type: "logos", items: [{ src: "http://insecure.example/a.png" }, { src: "https://cdn.example/b.png", alt: "B" }] },
      { type: "faq", items: [{ q: "Can I watch on my phone?", a: "Yes." }] },
      { type: "episodes", buttonText: "Unlock now", target: "#offer" },
    ]);
    expect(t?.type === "testimonials" && t.items).toEqual([{ quote: "Great", name: "A", role: "", rating: 5 }]);
    expect(l?.type === "logos" && l.items.map((item) => item.src)).toEqual(["", "https://cdn.example/b.png"]);
    expect(f?.type === "faq" && f.items[0]!.q).toBe("Can I watch on my phone?");
    expect(e?.type === "episodes" && e.target).toBe("#offer");
  });

  it("#offer is a valid target everywhere", () => {
    expect(normalizeTarget("#offer")).toBe("#offer");
    expect(normalizeTarget("#elsewhere")).toBe("");
    expect(normalizeDeadlineButtonUrl("#offer")).toBe("#offer");
    expect(deadlineButtonHref("#offer", "/l/x")).toBe("#offer");
  });
});

describe("locked teasers", () => {
  it("keep #offer only for the locked style", () => {
    expect(linkItems([{ label: "Download transcript", url: "#offer", style: "locked" }])).toEqual([{ label: "Download transcript", url: "#offer", style: "locked", newTab: false }]);
    expect(linkItems([{ label: "x", url: "#offer", style: "button" }])).toEqual([]);
    const form: Record<string, string> = { r_label_0: "Audio", r_url_0: "#offer", r_style_0: "locked" };
    expect(linkItemsFromForm((key) => form[key] ?? null, "r")[0]?.style).toBe("locked");
  });
});

describe("header bar on the episode's expiry", () => {
  const rules: FunnelRules = { mode: "evergreen", timing: "per_viewer", startAt: null, endAt: null, closeAfterHours: null, closeMode: "page", progression: "scheduled", watchPercent: 80, livestreamUrl: null, waitlistEnabled: false };
  const now = new Date("2026-11-28T12:00:00Z");
  it("counts down to the episode expiry, and hides without one", () => {
    const bar = { enabled: true, target: "episode" as const, at: null, withinHours: 0 };
    const expires = new Date("2026-11-29T10:00:00Z");
    expect(deadlineBar(rules, bar, { watched: {}, keys: [] }, now, expires)?.at).toEqual(expires);
    expect(deadlineBar(rules, bar, { watched: {}, keys: [] }, now, null)).toBeNull();
  });
});

describe("presets", () => {
  it("every preset has a type and mode; docuseries sets the episode page up", () => {
    for (const preset of FUNNEL_PRESETS) expect(presetBasics(preset).siteType).toMatch(/launch|microsite/);
    expect(presetBasics("live").mode).toBe("live");
    expect(presetBasics("microsite").siteType).toBe("microsite");
    const docu = presetColumns("docuseries");
    expect(docu).toMatchObject({ accessHours: 24, navLayout: "sidebar", deadlineBarPosition: "header", deadlineBarTarget: "episode", countdownStyle: "flip" });
    expect(presetColumns("live")).toEqual({});
    expect(normalizeBlocks(presetOfferBlocks("docuseries")).map((block) => block.type)).toEqual(["headline", "countdown", "pricing", "testimonials", "faq", "episodes"]);
    expect(presetOfferBlocks("evergreen")).toEqual([]);
    expect(presetDayResources("docuseries").every((item) => item.style === "locked" && item.url === "#offer")).toBe(true);
  });
});
