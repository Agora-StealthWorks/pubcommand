import { describe, expect, it } from "vitest";
import {
  ANALYSIS_SCHEMA,
  brainNote,
  locateCub,
  normalizeAnalysis,
  overallScore,
  promoTypeFromPrice,
  readability,
  type PromoAnalysisResult,
} from "./analysis";

const rated = (score: number) => ({ score, note: "n" });

function sample(): PromoAnalysisResult {
  return {
    summary: "Sells a newsletter.",
    detected: { publisher: "Acme", gurus: ["Jane Roe"], product: "Acme Letter", pricePoint: 49, promoType: "Front-end" },
    headline: {
      eyebrow: "",
      headline: "The One Stock",
      subhead: "",
      fourUs: { urgent: rated(12), unique: rated(0), ultraSpecific: rated(7.4), useful: rated(5) },
      verdict: "ok",
      alternatives: ["a", "b", "c"],
    },
    outline: [{ section: "Lead", summary: "s" }],
    sixteenWord: { bigIdea: "Big", questions: [], close: [] },
    cub: [],
    offer: { product: "p", price: "$49", term: "1 year", bonuses: [], guarantee: "60 days", urgency: "", summary: "s" },
    tease: { teased: false, subject: "", clues: [], guesses: [] },
    compliance: [],
    scores: [
      { name: "Hook strength", score: 8, note: "" },
      { name: "Believability", score: 6, note: "" },
      { name: "Specificity", score: 15, note: "" },
    ],
    strengths: ["Strong lead"],
    fixes: ["Add proof"],
    lessons: ["Specific beats vague"],
  };
}

describe("promo analysis", () => {
  it("clamps every 1-10 rating", () => {
    const result = normalizeAnalysis(sample());
    expect(result.headline.fourUs.urgent.score).toBe(10);
    expect(result.headline.fourUs.unique.score).toBe(1);
    expect(result.headline.fourUs.ultraSpecific.score).toBe(7);
    expect(result.scores.map((item) => item.score)).toEqual([8, 6, 10]);
  });

  it("computes the overall score from the sub-scores, not from the AI", () => {
    expect(overallScore(normalizeAnalysis(sample()))).toBe(8);
    expect(overallScore({ scores: [] })).toBeNull();
  });

  it("computes reading ease locally and skips tiny texts", () => {
    expect(readability("Too short.")).toBeNull();
    const text = "The cat sat on the mat. It was a good day. We ran to the park and back. ".repeat(5);
    const score = readability(text);
    expect(score?.ease).toBeGreaterThan(80);
    expect(score?.grade).toBeLessThan(5);
  });

  it("derives a type from price when the AI is unsure", () => {
    expect(promoTypeFromPrice(49)).toBe("Front-end");
    expect(promoTypeFromPrice(1995)).toBe("Backend VSL");
    expect(promoTypeFromPrice(5000)).toBe("Mega-Bundle VSL");
    expect(promoTypeFromPrice(null)).toBeNull();
  });

  it("finds CUB quotes in the copy, tolerating curly quotes and skipping overlaps", () => {
    const text = "Wall Street doesn’t want you to know this. Then a dull paragraph follows here.";
    const spans = locateCub(text, [
      { quote: "Wall Street doesn't want you to know this", type: "unbelievable", why: "", fix: "" },
      { quote: "doesn't want you", type: "boring", why: "", fix: "" },
      { quote: "not in the text at all", type: "confusing", why: "", fix: "" },
      { quote: "a dull paragraph", type: "boring", why: "", fix: "" },
    ]);
    expect(spans.map((span) => span.index)).toEqual([0, 3]);
    expect(text.slice(spans[1]!.start, spans[1]!.end)).toBe("a dull paragraph");
  });

  it("writes a Brain note with the lessons", () => {
    const note = brainNote({ title: "The One Stock", brandName: "MTA", score: 8, result: sample() });
    expect(note.title).toBe("Promo review: The One Stock");
    expect(note.body).toContain("Specific beats vague");
    expect(note.body).toContain("Score: 8/10");
  });

  it("keeps the schema strict so the AI answer always matches", () => {
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const obj = node as Record<string, unknown>;
      if (obj.type === "object") {
        expect(obj.additionalProperties).toBe(false);
        expect(Object.keys(obj.properties as object).sort()).toEqual([...(obj.required as string[])].sort());
      }
      Object.values(obj).forEach(walk);
    };
    walk(ANALYSIS_SCHEMA);
  });
});

describe("canonicalItem", () => {
  it("maps loose wording back to the canonical list", async () => {
    const { canonicalItem, SIXTEEN_WORD_QUESTIONS, CLOSE_STEPS, ANALYSIS_SYSTEM } = await import("./analysis");
    expect(canonicalItem("why now", SIXTEEN_WORD_QUESTIONS)).toBe("Why now?");
    expect(canonicalItem("What's in it for me", SIXTEEN_WORD_QUESTIONS)).toBe("What's in it for me?");
    expect(canonicalItem("guarantee", CLOSE_STEPS)).toBe("Guarantee");
    expect(canonicalItem("Something else", CLOSE_STEPS)).toBe("Something else");
    expect(ANALYSIS_SYSTEM).toContain('"Why now?"');
  });
});
