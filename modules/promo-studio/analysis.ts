/**
 * Promo Analyzer: shared constants (promo types, the 16-Word Sales Letter
 * questions and close steps), the numbers we compute ourselves (reading ease),
 * CUB highlighting, and the legacy v1 answer type. The analysis pipeline lives
 * in sections.ts (format), prompt.ts (instructions), parse.ts and score.ts
 * (reading the answer) and stored.ts (what is saved). Pure functions only.
 */

export const PROMO_TYPES = [
  "Front-end",
  "Backend Live Webinar",
  "Backend VSL",
  "Mega-Bundle Live Webinar",
  "Mega-Bundle VSL",
] as const;

export const PROMO_STATUSES = ["Active", "Old (Inactive)", "Draft (Untested)"] as const;

export const SIXTEEN_WORD_QUESTIONS = [
  "How is this different from everything else I've seen?",
  "What's in it for me?",
  "How do I know this is real?",
  "What's holding me back?",
  "Who or what is to blame?",
  "Why now?",
  "Why should I trust you?",
  "How does it work?",
  "How can I get started?",
  "What do I have to lose?",
] as const;

export const CLOSE_STEPS = [
  "Reveal the special report",
  "Introduce the subscription",
  "Social proof",
  "False close (price anchor)",
  "Bonuses",
  "Value stack",
  "Final price reveal",
  "Guarantee",
] as const;

export const SUB_SCORES = [
  "Hook strength",
  "Believability",
  "Specificity",
  "Emotional pull",
  "Momentum",
  "Offer clarity",
  "Call to action and urgency",
  "Audience fit",
] as const;

export type Rated = { score: number; note: string };
export type CubFlag = { quote: string; type: "confusing" | "unbelievable" | "boring"; why: string; fix: string };

/** The v1 answer (one JSON object), saved before November 2026. Read it through `analysisDigest` in stored.ts. */
export type PromoAnalysisResult = {
  summary: string;
  detected: {
    publisher: string;
    gurus: string[];
    product: string;
    pricePoint: number | null;
    promoType: string;
  };
  headline: {
    eyebrow: string;
    headline: string;
    subhead: string;
    fourUs: { urgent: Rated; unique: Rated; ultraSpecific: Rated; useful: Rated };
    verdict: string;
    alternatives: string[];
  };
  outline: { section: string; summary: string }[];
  sixteenWord: {
    questions: { question: string; answered: "strong" | "weak" | "missing"; evidence: string; improve: string }[];
    close: { step: string; present: boolean; note: string }[];
    bigIdea: string;
  };
  cub: CubFlag[];
  offer: {
    product: string;
    price: string;
    term: string;
    bonuses: string[];
    guarantee: string;
    urgency: string;
    summary: string;
  };
  /** What the promo teases without naming (a stock, an ingredient, a protocol...). */
  tease: { teased: boolean; subject: string; clues: string[]; guesses: { name: string; detail: string; confidence: "low" | "medium" | "high"; why: string }[] };
  /** Claims that break the brand's compliance rules. */
  compliance: { quote: string; rule: string; risk: "high" | "medium" | "low"; fix: string }[];
  scores: { name: string; score: number; note: string }[];
  strengths: string[];
  fixes: string[];
  lessons: string[];
};


const plain = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The canonical wording for an item the AI named loosely ("Why now" -> "Why now?"). Unknown text is kept. */
export function canonicalItem<T extends string>(value: string, list: readonly T[]): string {
  const wanted = plain(value);
  const exact = list.find((item) => plain(item) === wanted);
  if (exact) return exact;
  const partial = list.filter((item) => plain(item).startsWith(wanted) || wanted.startsWith(plain(item)));
  return partial.length === 1 ? partial[0]! : value;
}

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Flesch reading ease and Flesch-Kincaid grade, computed locally. */
export function readability(text: string): { ease: number; grade: number } | null {
  const words = text.match(/[A-Za-z][A-Za-z'’-]*/g) ?? [];
  if (words.length < 30) return null;
  const sentences = Math.max(1, (text.match(/[.!?]+(\s|$)/g) ?? []).length);
  const syl = words.reduce((sum, word) => sum + syllables(word), 0);
  const wps = words.length / sentences;
  const spw = syl / words.length;
  const ease = 206.835 - 1.015 * wps - 84.6 * spw;
  const grade = 0.39 * wps + 11.8 * spw - 15.59;
  return { ease: Math.round(ease * 10) / 10, grade: Math.round(grade * 10) / 10 };
}

/** Flesch reading-ease band, as shown on the score badges. */
export function readingEaseLabel(ease: number): string {
  if (ease >= 90) return "Very easy";
  if (ease >= 80) return "Easy";
  if (ease >= 70) return "Fairly easy";
  if (ease >= 60) return "Standard";
  if (ease >= 50) return "Fairly difficult";
  if (ease >= 30) return "Difficult";
  return "Very difficult";
}

/** Price-based promo type, used when the AI says Unknown. */
export function promoTypeFromPrice(price: number | null): string | null {
  if (price === null || !Number.isFinite(price)) return null;
  if (price < 200) return "Front-end";
  if (price < 3000) return "Backend VSL";
  return "Mega-Bundle VSL";
}

/** Find CUB quotes in the source so the copy can be shown with highlights. */
export function locateCub<T extends { quote: string }>(text: string, flags: readonly T[]): { start: number; end: number; index: number }[] {
  const squash = (value: string) => value.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  const haystack = squash(text);
  const spans: { start: number; end: number; index: number }[] = [];
  flags.forEach((flag, index) => {
    const needle = squash(flag.quote).trim();
    if (needle.length < 8) return;
    const start = haystack.indexOf(needle);
    if (start < 0) return;
    const end = start + needle.length;
    if (spans.some((span) => start < span.end && end > span.start)) return;
    spans.push({ start, end, index });
  });
  return spans.sort((a, b) => a.start - b.start);
}
