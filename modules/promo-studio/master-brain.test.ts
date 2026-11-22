import { describe, expect, it } from "vitest";
import { SAMPLE_ANSWER, SAMPLE_COPY } from "./fixtures";
import { legacyReviewNote, promoCopyRef, promoMasterNotes, promoReviewRef } from "./master-brain";
import { buildStored } from "./stored";

const promo = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Morning Habit",
  sourceText: SAMPLE_COPY,
  publisher: "Vital Gazette",
  gurus: ["Dr. Alan Reyes"],
  product: "Vital Gazette Letter",
  promoCode: "VGL123",
  effectivenessScore: 7.4,
};

describe("promoMasterNotes", () => {
  it("builds the review and copy notes the analyzer teaches, with the same sourceRefs", () => {
    const stored = buildStored({ raw: SAMPLE_ANSWER, finished: true, visual: false, matches: [] });
    const notes = promoMasterNotes({ promo, brandName: "Vital", analysis: { result: stored, createdAt: new Date("2026-11-01T00:00:00Z"), score: 7.4 } });
    expect(notes.map((n) => n.sourceRef)).toEqual([promoReviewRef(promo.id), promoCopyRef(promo.id)]);
    expect(notes[0]!.title).toBe("Promo review: Morning Habit");
    expect(notes[0]!.folder).toBe("Promo reviews");
    expect(notes[0]!.body).toContain("Brand: Vital");
    expect(notes[0]!.body).toContain("Analyzed: 2026-11-01");
    expect(notes[1]!.folder).toBe("Promo copy");
    expect(notes[1]!.body).toContain("Promo code: VGL123");
    expect(notes[1]!.body).toContain("THE 4-MINUTE MORNING HABIT");
  });

  it("keeps the copy when there is no analysis, and nothing when there is no text either", () => {
    expect(promoMasterNotes({ promo, brandName: "Vital", analysis: null }).map((n) => n.folder)).toEqual(["Promo copy"]);
    expect(promoMasterNotes({ promo: { ...promo, sourceText: "  " }, brandName: "Vital", analysis: null })).toEqual([]);
  });

  it("reads old JSON analyses through the digest", () => {
    const result = {
      summary: "A health letter about a kitchen spice.",
      headline: { eyebrow: "", headline: "The 4-Minute Morning Habit", subhead: "" },
      scores: [{ name: "Headline", score: 8, note: "Curious" }],
      strengths: ["Clear benefit"],
      improvements: [],
    };
    const note = legacyReviewNote({ title: "Old one", brandName: "Vital", result, analyzedAt: null, meta: ["Publisher: Vital Gazette"] });
    if (note) {
      expect(note.body).toContain("# Promo review: Old one");
      expect(note.body).toContain("Publisher: Vital Gazette");
    }
    expect(legacyReviewNote({ title: "Broken", brandName: "Vital", result: { nope: true }, analyzedAt: null, meta: [] })).toBeNull();
  });
});
