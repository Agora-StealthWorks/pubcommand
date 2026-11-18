/**
 * The Promo Analyzer score. The AI rates eight conversion dimensions; the final
 * score is ours: a weighted blend of those ratings plus one small adjustment the
 * AI may ask for (at most one point either way), clamped to 1-10, one decimal.
 *
 * The dimensions and their relative weights are the publisher's business
 * decisions, carried over unchanged from the OxfordHub Promo Analyzer: the
 * opening, believability and emotion decide whether a skeptical reader keeps
 * going, audience fit comes next, and specificity is weighted lightest because
 * believability already captures most of it.
 */

export const DIMENSIONS = [
  "Hook Strength",
  "Believability",
  "Specificity",
  "Emotional Pull",
  "Momentum",
  "Offer Clarity",
  "Call to Action / Urgency",
  "Audience Fit",
] as const;
export type DimensionName = (typeof DIMENSIONS)[number];

export const DIMENSION_WEIGHTS: Record<DimensionName, number> = {
  "Hook Strength": 1.6,
  Believability: 1.5,
  Specificity: 0.8,
  "Emotional Pull": 1.4,
  Momentum: 0.9,
  "Offer Clarity": 1.0,
  "Call to Action / Urgency": 0.9,
  "Audience Fit": 1.3,
};

export const TOTAL_WEIGHT = DIMENSIONS.reduce((sum, name) => sum + DIMENSION_WEIGHTS[name], 0);

/** The largest adjustment the AI may make to the blended score, either way. */
export const MAX_ADJUSTMENT = 1;

export type DimensionScore = { name: DimensionName; score: number; rationale: string };
export type ScoreAdjustment = { value: number; reason: string };
export type Scorecard = {
  dimensions: DimensionScore[];
  adjustment: ScoreAdjustment | null;
  rationale: string;
  /** Weighted blend before the adjustment, one decimal. Null without any dimension. */
  blended: number | null;
  /** The score shown everywhere. Null without any dimension. */
  final: number | null;
};

const round1 = (value: number) => Math.round(value * 10) / 10;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** Strip markdown emphasis and normalise dashes so line formats parse however the AI decorated them. */
export function plainLine(line: string): string {
  return line
    .replace(/\*\*|__/g, "")
    .replace(/(^|\s)[*_](\S[^*_]*?)[*_](?=\s|$|[.,:;])/g, "$1$2")
    .replace(/−/g, "-")
    .replace(/[‐‑‒–—―]/g, "—")
    .replace(/^\s*(?:[-•*>]+|#+)\s*/, "")
    .trim();
}

/** Which dimension a label means, tolerant of the AI's wording ("CTA", "Emotional appeal", "Hook"). */
export function dimensionFor(label: string): DimensionName | null {
  const d = label.toLowerCase();
  if (d.includes("hook")) return "Hook Strength";
  if (d.includes("believ") || d.includes("credib")) return "Believability";
  if (d.includes("specific")) return "Specificity";
  if (d.includes("emotion")) return "Emotional Pull";
  if (d.includes("momentum") || d.includes("flow")) return "Momentum";
  if (d.includes("offer")) return "Offer Clarity";
  if (d.includes("call to action") || d.includes("urgency") || /\bcta\b/.test(d)) return "Call to Action / Urgency";
  if (d.includes("audience") || d.includes("reader fit")) return "Audience Fit";
  return null;
}

// "1. Hook Strength: 8/10 — rationale", "Hook Strength — 8.5 / 10: rationale", "Hook Strength: 8 - rationale".
const DIMENSION_LINE = /^(?:\d+\s*[.)]\s*)?([A-Za-z][A-Za-z /&'-]*?)\s*[:—]\s*(\d+(?:\.\d+)?)\s*(?:\/\s*10|out of 10)?\s*(?:[—:.,]\s*|\s+)?(.*)$/;

/** Parse the scorecard section. Unknown lines are ignored; a dimension listed twice keeps its first rating. */
export function parseScorecard(text: string): Scorecard {
  const dimensions: DimensionScore[] = [];
  let adjustment: ScoreAdjustment | null = null;
  const rationale: string[] = [];
  let inRationale = false;
  for (const raw of text.split("\n")) {
    const line = plainLine(raw);
    if (!line) continue;
    const adj = /^adjust(?:ment)?\s*[:—]\s*([+-]?\s*\d+(?:\.\d+)?)\s*(?:[—:,]\s*)?(.*)$/i.exec(line);
    if (adj) {
      const value = Number(adj[1]!.replace(/\s+/g, ""));
      if (Number.isFinite(value) && value !== 0) adjustment = { value: clamp(value, -MAX_ADJUSTMENT, MAX_ADJUSTMENT), reason: adj[2]!.trim() };
      inRationale = false;
      continue;
    }
    const why = /^(?:rationale|verdict|overall)\s*[:—]\s*(.*)$/i.exec(line);
    if (why) {
      inRationale = true;
      if (why[1]!.trim()) rationale.push(why[1]!.trim());
      continue;
    }
    const dim = DIMENSION_LINE.exec(line);
    const name = dim ? dimensionFor(dim[1]!) : null;
    if (dim && name) {
      const score = Number(dim[2]);
      if (Number.isFinite(score) && score >= 0 && score <= 10 && !dimensions.some((d) => d.name === name)) {
        dimensions.push({ name, score: clamp(score, 1, 10), rationale: dim[3]!.replace(/^[\s—:.,-]+/, "").trim() });
      }
      inRationale = false;
      continue;
    }
    if (inRationale) rationale.push(line);
  }
  dimensions.sort((a, b) => DIMENSIONS.indexOf(a.name) - DIMENSIONS.indexOf(b.name));
  const blended = blend(dimensions);
  return {
    dimensions,
    adjustment,
    rationale: rationale.join(" ").replace(/\s+/g, " ").trim(),
    blended,
    final: finalScore(dimensions, adjustment?.value ?? 0),
  };
}

/** Weighted blend of the ratings. With all eight present the canonical total weight is used; otherwise the weight seen. */
export function blend(dimensions: readonly { name: DimensionName; score: number }[]): number | null {
  if (!dimensions.length) return null;
  let weighted = 0;
  let used = 0;
  for (const d of dimensions) {
    const w = DIMENSION_WEIGHTS[d.name];
    weighted += d.score * w;
    used += w;
  }
  return round1(weighted / (dimensions.length >= DIMENSIONS.length ? TOTAL_WEIGHT : used));
}

/** Blend plus the bounded adjustment, clamped to 1-10, one decimal. */
export function finalScore(dimensions: readonly { name: DimensionName; score: number }[], adjustment = 0): number | null {
  if (!dimensions.length) return null;
  let weighted = 0;
  let used = 0;
  for (const d of dimensions) {
    const w = DIMENSION_WEIGHTS[d.name];
    weighted += d.score * w;
    used += w;
  }
  const base = weighted / (dimensions.length >= DIMENSIONS.length ? TOTAL_WEIGHT : used);
  return round1(clamp(base + clamp(adjustment, -MAX_ADJUSTMENT, MAX_ADJUSTMENT), 1, 10));
}

/** Badge colour band used by the score badge and the dimension bars. */
export function scoreBand(score: number): "high" | "mid" | "low" {
  if (score >= 8) return "high";
  if (score >= 6) return "mid";
  return "low";
}
