import { describe, expect, it } from "vitest";
import { canonicalItem, CLOSE_STEPS, locateCub, promoTypeFromPrice, readability, readingEaseLabel, SIXTEEN_WORD_QUESTIONS } from "./analysis";

describe("promo analysis helpers", () => {
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
});

describe("canonicalItem", () => {
  it("maps loose wording back to the canonical list", () => {
    expect(canonicalItem("why now", SIXTEEN_WORD_QUESTIONS)).toBe("Why now?");
    expect(canonicalItem("What's in it for me", SIXTEEN_WORD_QUESTIONS)).toBe("What's in it for me?");
    expect(canonicalItem("guarantee", CLOSE_STEPS)).toBe("Guarantee");
    expect(canonicalItem("Something else", CLOSE_STEPS)).toBe("Something else");
    expect(readingEaseLabel(72)).toBe("Fairly easy");
    expect(readingEaseLabel(10)).toBe("Very difficult");
  });
});
