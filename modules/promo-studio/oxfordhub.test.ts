import { describe, expect, it } from "vitest";
import { componentContent, kindForOldCategory, kindForOldSlug, lessonFromOld, matchPackagePromo, packagerKindFromName, packagerKindOfPromo, performanceFromOld, rawFromOldSections, reviewIdFromNote, sourceCopyFromNote } from "./oxfordhub";
import { parseAnalysis } from "./parse";
import { buildStored, effectiveScorecard } from "./stored";

describe("old analyzer reviews", () => {
  const sections = {
    headline: '**Eyebrow:** "AI Expert Reveals..."\n**Main Headline:** "NVIDIA buyout"\n**Subheadline:** "Jan 6"\n- **Urgent**: present — date',
    outline: "1. **The Lead** — Blue spike reveal",
    evaldo: "1. **How is this different** — Strong.",
    cub: '[{"text":"fourth most influential person","type":"unbelievable","reason":"Unverified"}]',
    offer: "- **Big Idea**: An AI system\n- **Price**: $1,995",
    stockTease: "- **Clues given**: ASIC maker",
    effectiveness: "1. Hook Strength: 9/10 — dated prediction\n2. Believability: 8/10 — proof\n3. Specificity: 9/10 — names\n4. Emotional Pull: 8/10 — villain\n5. Momentum: 7/10 — fatigue\n6. Offer Clarity: 8/10 — anchor\n7. Call to Action/Urgency: 8/10 — deadline\n8. Audience Fit: 8/10 — fit\nAdjustment: +0.5 — gold-standard pattern\nRationale: Strong.",
    promoIntel: { guru: { name: "James Altucher", backstory_claims: ["Wrote his first AI program in 1987"] } },
  };

  it("turns sections into a stored analysis PubCommand reads", () => {
    const stored = buildStored({ raw: rawFromOldSections(sections), finished: true, visual: false, matches: [] });
    const parsed = parseAnalysis(stored.sections);
    expect(parsed.headline.headline).toContain("NVIDIA");
    expect(parsed.cub).toHaveLength(1);
    expect(parsed.intel?.expert?.name).toBe("James Altucher");
    const card = effectiveScorecard(stored);
    expect(card.dimensions).toHaveLength(8);
    expect(card.final).toBeGreaterThan(8);
    expect(stored.truncated).toBe(false);
  });

  it("builds the scorecard from subScores when an older review has none", () => {
    const raw = rawFromOldSections({ headline: "**Main Headline:** X" }, [{ dimension: "Hook Strength", score: 7, rationale: "ok" }, { dimension: "Believability", score: 6, rationale: "" }]);
    const card = effectiveScorecard(buildStored({ raw, finished: true, visual: false, matches: [] }));
    expect(card.dimensions.map((d) => d.score)).toEqual([7, 6]);
  });

  it("reads the promo text and review id from a vault source-copy note", () => {
    const note = `---\ntitle: "Promo Copy - X"\nreview_id: 64734336-628c-4234-ae5f-31b4084d7106\n---\n\n# Promo Copy - X\n\nFull source copy.\n\n- **Analysis:** [[X]]\n\n---\n\nFORMER CIA ADVISOR RELEASES:\n\n---\n\nmore copy`;
    expect(sourceCopyFromNote(note)).toBe("FORMER CIA ADVISOR RELEASES:\n\n---\n\nmore copy");
    expect(reviewIdFromNote(note)).toBe("64734336-628c-4234-ae5f-31b4084d7106");
  });
});

describe("old Packager", () => {
  it("maps training-file categories and slugs to component kinds", () => {
    expect(kindForOldCategory("VSL Lift Notes")).toBe("vsl-lift-notes");
    expect(kindForOldCategory("Order Form")).toBe("order-form");
    expect(kindForOldCategory("Exit Popup (Order Form)")).toBe("exit-popup");
    expect(kindForOldCategory("Hotlist Warm-Up Emails")).toBe("event-warmup-emails");
    expect(kindForOldCategory("Lifetime / Unlimited Upsell")).toBe("lifetime-upsell");
    expect(kindForOldCategory("Sign Up Page")).toBeNull();
    expect(kindForOldSlug("hotlist-lift-notes")).toBe("event-lift-notes");
    expect(kindForOldSlug("space-ads")).toBe("space-ads");
    expect(kindForOldSlug("nope")).toBeNull();
  });

  it("writes package items as ### blocks", () => {
    expect(componentContent("space-ads", [{ text: "A" }, { text: " B " }, { text: "" }])).toMatch(/^### .+ 1\n\nA\n\n### .+ 2\n\nB$/);
  });
});

describe("old lessons and results", () => {
  it("keeps the lesson, its context and a known category", () => {
    const lesson = lessonFromOld({ lesson: "Promos that assign a guru without a track record should lose credibility points. More detail here.", category: "credibility", guru: "Bryan Bottarelli", performanceTier: "failed", evidenceCount: 1 });
    expect(lesson).toMatchObject({ category: "proof", evidenceCount: 1, fromResults: true });
    expect(lesson!.title).toBe("Promos that assign a guru without a track record should lose credibility points.");
    expect(lesson!.body).toContain("Guru: Bryan Bottarelli");
    expect(lessonFromOld({ lesson: "x".repeat(30), category: "scoring_calibration" })!.category).toBe("other");
    expect(lessonFromOld({ lesson: " " })).toBeNull();
  });

  it("reads sheet stats", () => {
    const row = performanceFromOld({ promoCode: "SEI NVDA BUY - 1", stats: { Affiliate: "AF: Paradigm Press", "Primary Item": "SEI - True Alpha", "Total IRIS Promotion Views": "1016864", "Total IRIS Clicks to Order From": "28335", "Total Gross Orders": "7188", "Total Gross Revenue": "$14,472,118.28" } });
    expect(row).toMatchObject({ codeKey: "SEINVDABUY1", views: 1016864, clicks: 28335, orders: 7188, revenue: 14472118.28, label: "AF: Paradigm Press · SEI - True Alpha" });
    expect(performanceFromOld({ promoCode: " " })).toBeNull();
  });
});

describe("old packages", () => {
  const promos = [
    { id: "moon", reviewId: "r1", names: ["PMK Moonlight Trade  (V4).docx"] },
    { id: "empire", reviewId: "r2", names: ["TPU Empire for legal_LEGAL_mk_SPAS.docx"] },
    { id: "energy", reviewId: "r3", names: ["SKI Infinite Energy (4).docx"] },
  ];
  it("attaches only packages that were attached in OxfordHub, to a promo that is really there", () => {
    expect(matchPackagePromo({ title: "PMK Moonlight Package", reviewId: "gone" }, promos)).toBe("moon");
    expect(matchPackagePromo({ title: "TPU Empire", reviewId: "gone" }, promos)).toBe("empire");
    expect(matchPackagePromo({ title: "Anything", reviewId: "r3" }, promos)).toBe("energy");
    expect(matchPackagePromo({ title: "TPU Energy", reviewId: "gone" }, promos)).toBeNull();
    expect(matchPackagePromo({ title: "PMK Moonlight Package", reviewId: null }, promos)).toBeNull();
  });
});

describe("Packager output is not a promo", () => {
  it("recognizes Packager components by name", () => {
    expect(packagerKindOfPromo({ title: "SKI Infinite lifts" })).toBe("vsl-lift-notes");
    expect(packagerKindFromName("TPU Unicorn Lift Notes_LEGAL.docx")).toBe("vsl-lift-notes");
    expect(packagerKindFromName("PMK Hotlist Lifts.docx")).toBe("event-lift-notes");
    expect(packagerKindFromName("SEI Space Ads v2.docx")).toBe("space-ads");
    expect(packagerKindFromName("SEI_Exit_Popup.docx")).toBe("exit-popup");
    expect(packagerKindFromName("TPU OF final.docx")).toBe("order-form");
    expect(packagerKindFromName("Webinar Warm-Up Emails")).toBe("event-warmup-emails");
    expect(packagerKindFromName("Facebook Video Ads - SKI")).toBe("facebook-video-ads");
    expect(packagerKindOfPromo({ title: "Lifetime Upsell", filename: null })).toBe("lifetime-upsell");
  });

  it("leaves promos alone", () => {
    for (const name of ["PMK Moonlight Trade  (V4).docx", "SEI NVDA Buyout VSL", "Lift-Off Stocks of 2027", "The Space Race Promo", "Exit Strategy Webinar", "AI Infinite Profits"]) expect(packagerKindFromName(name)).toBeNull();
  });
});
