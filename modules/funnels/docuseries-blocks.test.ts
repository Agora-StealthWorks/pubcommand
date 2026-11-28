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
    expect(t?.type === "testimonials" && t.items).toEqual([{ quote: "Great", name: "A", role: "", rating: 5, photoAssetId: "", photoSrc: "" }]);
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

describe("design gaps closed (fonts, colours, layout, pricing, rating, uploads)", () => {
  it("loads a separate heading font and exposes second accent, highlight and layout sizes", async () => {
    const { normalizeDesign, fontHref, designCss } = await import("./design");
    const d = normalizeDesign({ page: { font: "inter", headingFont: "playfair", accent: "#111111", accent2: "#f2b43a", highlight: "#e11d2a", contentWidth: 1200, listWidth: 9999, videoRadius: 16, videoPadding: 0 } });
    expect(d.page.headingFont).toBe("playfair");
    expect(d.page.listWidth).toBe(640);
    expect(fontHref(d)).toBe("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Playfair+Display:wght@400;600;700;800&display=swap");
    const css = designCss(d);
    expect(css).toContain("--pcf-accent2:#f2b43a");
    expect(css).toContain("--pcf-highlight:#e11d2a");
    expect(css).toContain("--pcf-content-w:1200px");
    expect(css).toContain("--pcf-video-r:16px");
    expect(css).toContain(".pcf-frame{background:transparent;border:0}");
    expect(css).toContain('--pcf-heading-font:"Playfair Display", Georgia, serif');
    // Unset = the accent / body font, and junk is refused.
    const plain = normalizeDesign({ page: { headingFont: "comic", accent2: "red" } });
    expect(plain.page).toMatchObject({ headingFont: null, accent2: null, highlight: null, contentWidth: 960 });
  });

  it("pricing tiers: crossed-off lines, new tab, colour and image", async () => {
    const { normalizeBlock, offerLine } = await import("./blocks");
    expect(offerLine("~ Bonus cookbook | $49")).toEqual({ text: "Bonus cookbook | $49", off: true });
    expect(offerLine("All 9 episodes")).toEqual({ text: "All 9 episodes", off: false });
    const block = normalizeBlock({ type: "pricing", tiers: [{ name: "Gold", newTab: true, tone: "accent2", imageAssetId: "11111111-2222-3333-4444-555555555555", imageSrc: "javascript:alert(1)" }, { name: "Basic", tone: "rainbow" }] });
    if (block?.type !== "pricing") throw new Error("expected pricing");
    expect(block.tiers[0]).toMatchObject({ newTab: true, tone: "accent2", imageAssetId: "11111111-2222-3333-4444-555555555555", imageSrc: "" });
    expect(block.tiers[1]).toMatchObject({ newTab: false, tone: "accent" });
  });

  it("star rating block clamps the score", async () => {
    const { normalizeBlock, ratingScore } = await import("./blocks");
    expect(ratingScore("4,93")).toBe("4.9");
    expect(ratingScore("7", 5)).toBe("5");
    expect(ratingScore("abc")).toBe("");
    expect(normalizeBlock({ type: "rating", score: "4.9", count: "2,341 reviews" })).toMatchObject({ type: "rating", score: "4.9", outOf: 5, count: "2,341 reviews" });
  });

  it("episode grid shows descriptions by default; testimonials take a photo; buttons a colour", async () => {
    const { normalizeBlock } = await import("./blocks");
    expect(normalizeBlock({ type: "episodes" })).toMatchObject({ showSummary: true });
    expect(normalizeBlock({ type: "testimonials", items: [{ quote: "Great", photoSrc: "https://example.com/a.jpg" }] })).toMatchObject({ items: [{ photoSrc: "https://example.com/a.jpg", photoAssetId: "" }] });
    expect(normalizeBlock({ type: "button", tone: "highlight" })).toMatchObject({ tone: "highlight" });
    expect(normalizeBlock({ type: "headline", accentTone: "accent2" })).toMatchObject({ accentTone: "accent2" });
  });
});
