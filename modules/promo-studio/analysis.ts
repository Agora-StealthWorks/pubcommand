/**
 * Promo Analyzer: the instructions, the answer shape, and the numbers we compute
 * ourselves (reading ease, the overall score). Pure functions only, so the whole
 * file is unit tested without a database or the AI.
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
  stockTease: { teased: boolean; clues: string[]; guesses: { ticker: string; company: string; confidence: "low" | "medium" | "high"; why: string }[] };
  scores: { name: string; score: number; note: string }[];
  strengths: string[];
  fixes: string[];
  lessons: string[];
};

const rated = {
  type: "object",
  additionalProperties: false,
  required: ["score", "note"],
  properties: { score: { type: "integer" }, note: { type: "string" } },
};

const str = { type: "string" };
const strList = { type: "array", items: str };

/** JSON Schema the AI must answer in. Mirrors PromoAnalysisResult. */
export const ANALYSIS_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "detected", "headline", "outline", "sixteenWord", "cub", "offer", "stockTease", "scores", "strengths", "fixes", "lessons"],
  properties: {
    summary: str,
    detected: {
      type: "object",
      additionalProperties: false,
      required: ["publisher", "gurus", "product", "pricePoint", "promoType"],
      properties: {
        publisher: str,
        gurus: strList,
        product: str,
        pricePoint: { anyOf: [{ type: "number" }, { type: "null" }] },
        promoType: { type: "string", enum: [...PROMO_TYPES, "Unknown"] },
      },
    },
    headline: {
      type: "object",
      additionalProperties: false,
      required: ["eyebrow", "headline", "subhead", "fourUs", "verdict", "alternatives"],
      properties: {
        eyebrow: str,
        headline: str,
        subhead: str,
        fourUs: {
          type: "object",
          additionalProperties: false,
          required: ["urgent", "unique", "ultraSpecific", "useful"],
          properties: { urgent: rated, unique: rated, ultraSpecific: rated, useful: rated },
        },
        verdict: str,
        alternatives: strList,
      },
    },
    outline: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["section", "summary"],
        properties: { section: str, summary: str },
      },
    },
    sixteenWord: {
      type: "object",
      additionalProperties: false,
      required: ["questions", "close", "bigIdea"],
      properties: {
        bigIdea: str,
        questions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["question", "answered", "evidence", "improve"],
            properties: {
              question: { type: "string", enum: [...SIXTEEN_WORD_QUESTIONS] },
              answered: { type: "string", enum: ["strong", "weak", "missing"] },
              evidence: str,
              improve: str,
            },
          },
        },
        close: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["step", "present", "note"],
            properties: { step: { type: "string", enum: [...CLOSE_STEPS] }, present: { type: "boolean" }, note: str },
          },
        },
      },
    },
    cub: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["quote", "type", "why", "fix"],
        properties: {
          quote: str,
          type: { type: "string", enum: ["confusing", "unbelievable", "boring"] },
          why: str,
          fix: str,
        },
      },
    },
    offer: {
      type: "object",
      additionalProperties: false,
      required: ["product", "price", "term", "bonuses", "guarantee", "urgency", "summary"],
      properties: { product: str, price: str, term: str, bonuses: strList, guarantee: str, urgency: str, summary: str },
    },
    stockTease: {
      type: "object",
      additionalProperties: false,
      required: ["teased", "clues", "guesses"],
      properties: {
        teased: { type: "boolean" },
        clues: strList,
        guesses: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["ticker", "company", "confidence", "why"],
            properties: {
              ticker: str,
              company: str,
              confidence: { type: "string", enum: ["low", "medium", "high"] },
              why: str,
            },
          },
        },
      },
    },
    scores: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "score", "note"],
        properties: { name: { type: "string", enum: [...SUB_SCORES] }, score: { type: "integer" }, note: str },
      },
    },
    strengths: strList,
    fixes: strList,
    lessons: strList,
  },
};

/** Stable instructions (cached by the AI). Brand context goes in the user message. */
export const ANALYSIS_SYSTEM = `You are a senior direct-response copy chief reviewing a financial newsletter sales promo (a sales letter, video sales letter script, or webinar script).

Default reader: financially literate men and women aged 50 to 75 who invest their own money. They are not professional traders. They are skeptical of hype and have seen many promos.

Judge the copy as written. Quote it exactly when you cite it. Never invent facts about the promo, and never supply market facts, prices, or returns of your own.

Answer every part of the JSON schema:

- summary: two or three plain sentences on what this promo sells and how.
- detected: publisher, gurus (the named editors or experts), product, headline price as a number (null if none), and promo type. Front-end means a low-priced newsletter offer. Backend means a higher-priced service sold to existing buyers, either by live webinar or video sales letter. Mega-Bundle means many services sold together. Use Unknown when unclear.
- headline: copy the eyebrow, headline and subhead exactly (empty string if missing). Rate the headline 1 to 10 on each of the 4 U's (urgent, unique, ultra-specific, useful) with one line each. Give a verdict and three stronger alternative headlines in the same voice.
- outline: the promo's structure as an ordered list of sections, each with a one-line summary.
- sixteenWord: the big idea in one sentence. For each of the 10 reader questions of the 16-Word Sales Letter framework, say whether the copy answers it strongly, weakly, or not at all, quote the evidence, and say how to improve it. Then for each close step, say whether it is present with a note.
- cub: the most important places where the copy is Confusing, Unbelievable, or Boring. Each entry quotes an exact passage of 5 to 40 words copied character for character from the promo, says why it fails, and gives a fix. Give 6 to 15 entries, most important first.
- offer: product, price, term, bonuses, guarantee, urgency device, and a short summary.
- stockTease: whether the promo teases a stock without naming it, the clues it gives, and up to three ticker guesses with confidence and reasoning. Mark low confidence unless the clues are unmistakable.
- scores: each of the 8 dimensions scored 1 to 10 with a one-line reason. A 5 is an ordinary promo; reserve 9 and 10 for copy you would hold up as a model.
- strengths: the three to five things that work best.
- fixes: the three to five changes that would lift response most, most important first.
- lessons: two to four reusable copywriting lessons this promo teaches, written so they make sense without the promo.`;

/** Brand context and the copy, as the user message. */
export function analysisPrompt(input: { brandName: string; title: string; text: string; trainingNotes?: string[] }): string {
  const notes = input.trainingNotes?.length
    ? `\n\nNotes from this publisher's past reviews (use them to calibrate, not as facts about this promo):\n${input.trainingNotes.map((note) => `- ${note}`).join("\n")}`
    : "";
  const body = input.text.trim() ? `\n\n<promo>\n${input.text}\n</promo>` : "\n\nThe promo is the attached PDF.";
  return `Brand: ${input.brandName}\nPromo: ${input.title}${notes}${body}`;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** Clean up whatever the AI returned so the UI never sees a 0 or 47 on a 1-10 scale. */
export function normalizeAnalysis(raw: PromoAnalysisResult): PromoAnalysisResult {
  const fix = (r: Rated): Rated => ({ score: clamp(Math.round(r.score), 1, 10), note: r.note });
  return {
    ...raw,
    headline: {
      ...raw.headline,
      fourUs: {
        urgent: fix(raw.headline.fourUs.urgent),
        unique: fix(raw.headline.fourUs.unique),
        ultraSpecific: fix(raw.headline.fourUs.ultraSpecific),
        useful: fix(raw.headline.fourUs.useful),
      },
    },
    scores: raw.scores.map((item) => ({ ...item, score: clamp(Math.round(item.score), 1, 10) })),
  };
}

/** Overall effectiveness on 1-10, from the sub-scores (we compute it, the AI does not). */
export function overallScore(result: Pick<PromoAnalysisResult, "scores">): number | null {
  if (result.scores.length === 0) return null;
  const total = result.scores.reduce((sum, item) => sum + item.score, 0);
  return Math.round((total / result.scores.length) * 10) / 10;
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

/** Price-based promo type, used when the AI says Unknown. */
export function promoTypeFromPrice(price: number | null): string | null {
  if (price === null || !Number.isFinite(price)) return null;
  if (price < 200) return "Front-end";
  if (price < 3000) return "Backend VSL";
  return "Mega-Bundle VSL";
}

/** Find CUB quotes in the source so the copy can be shown with highlights. */
export function locateCub(text: string, flags: readonly CubFlag[]): { start: number; end: number; index: number }[] {
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

/** The Brain note a finished analysis teaches the brand's mini-brain. */
export function brainNote(input: { title: string; brandName: string; score: number | null; result: PromoAnalysisResult }): {
  title: string;
  body: string;
} {
  const r = input.result;
  const lines = [
    `# Promo review: ${input.title}`,
    "",
    `Brand: ${input.brandName}${r.detected.publisher ? ` · Publisher: ${r.detected.publisher}` : ""}${r.detected.gurus.length ? ` · Guru: ${r.detected.gurus.join(", ")}` : ""}`,
    `Score: ${input.score ?? "n/a"}/10 · Type: ${r.detected.promoType}`,
    "",
    `**Headline:** ${r.headline.headline || "(none)"}`,
    `**Big idea:** ${r.sixteenWord.bigIdea}`,
    "",
    r.summary,
    "",
    "## What works",
    ...r.strengths.map((item) => `- ${item}`),
    "",
    "## What to fix",
    ...r.fixes.map((item) => `- ${item}`),
    "",
    "## Lessons",
    ...r.lessons.map((item) => `- ${item}`),
  ];
  return { title: `Promo review: ${input.title}`, body: lines.join("\n") };
}
