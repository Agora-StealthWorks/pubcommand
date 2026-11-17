/**
 * Similar-promo outcomes: a plain k-nearest-neighbour over the eight analysis
 * sub-scores and promo type. It only shows when the data has earned it:
 * at least 30 promos with both sub-scores and a real-world score, AND
 * leave-one-out accuracy above the base rate (always guessing the most common
 * band). Otherwise the caller gets the reason it is hidden. No AI involved.
 */
import { SUB_SCORES } from "./analysis";

export const MIN_TRAINING_PAIRS = 30;

export type OutcomeBand = "high" | "middle" | "low";
export const BAND_LABELS: Record<OutcomeBand, string> = { high: "7–10", middle: "4–6.9", low: "1–3.9" };

export function bandOf(score: number): OutcomeBand {
  if (score >= 7) return "high";
  if (score >= 4) return "middle";
  return "low";
}

export type TrainingPair = {
  id: string;
  title: string;
  promoType: string | null;
  vector: number[];
  /** Real-world score, 1-10. */
  outcome: number;
};

/** The eight sub-scores in a fixed order, or null when any is missing (no guessing). */
export function scoreVector(scores: readonly { name: string; score: number }[] | null | undefined): number[] | null {
  if (!scores?.length) return null;
  const vector: number[] = [];
  for (const name of SUB_SCORES) {
    const hit = scores.find((item) => item.name === name);
    if (!hit || !Number.isFinite(hit.score)) return null;
    vector.push(hit.score);
  }
  return vector;
}

/** Euclidean distance over sub-scores, with a 1-point credit for the same promo type. */
export function distance(a: { vector: number[]; promoType: string | null }, b: { vector: number[]; promoType: string | null }): number {
  let sum = 0;
  for (let i = 0; i < a.vector.length; i += 1) sum += (a.vector[i]! - (b.vector[i] ?? 0)) ** 2;
  const credit = a.promoType && a.promoType === b.promoType ? 1 : 0;
  return Math.max(0, Math.sqrt(sum) - credit);
}

export function kFor(n: number): number {
  return Math.min(5, Math.max(3, Math.floor(Math.sqrt(n))));
}

export function nearest(subject: { id?: string; vector: number[]; promoType: string | null }, pool: readonly TrainingPair[], k: number) {
  return pool
    .filter((pair) => pair.id !== subject.id)
    .map((pair) => ({ ...pair, distance: Math.round(distance(subject, pair) * 100) / 100 }))
    .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))
    .slice(0, k);
}

/** Most common band among neighbours; ties go to the band of the closest neighbour. */
export function majorityBand(neighbours: readonly { outcome: number }[]): { band: OutcomeBand; count: number } {
  const counts = new Map<OutcomeBand, number>();
  for (const item of neighbours) counts.set(bandOf(item.outcome), (counts.get(bandOf(item.outcome)) ?? 0) + 1);
  let best: OutcomeBand = neighbours[0] ? bandOf(neighbours[0].outcome) : "middle";
  let bestCount = counts.get(best) ?? 0;
  for (const [band, count] of counts) {
    if (count > bestCount) {
      best = band;
      bestCount = count;
    }
  }
  return { band: best, count: bestCount };
}

export function leaveOneOut(pairs: readonly TrainingPair[]): { accuracy: number; baseRate: number } {
  if (pairs.length < 2) return { accuracy: 0, baseRate: 1 };
  const bands = new Map<OutcomeBand, number>();
  for (const pair of pairs) bands.set(bandOf(pair.outcome), (bands.get(bandOf(pair.outcome)) ?? 0) + 1);
  const baseRate = Math.max(...bands.values()) / pairs.length;
  const k = kFor(pairs.length - 1);
  let correct = 0;
  for (const pair of pairs) {
    const { band } = majorityBand(nearest(pair, pairs, k));
    if (band === bandOf(pair.outcome)) correct += 1;
  }
  return { accuracy: correct / pairs.length, baseRate };
}

export type SimilarOutcome =
  | { shown: false; reason: string; pairs: number; accuracy?: number; baseRate?: number }
  | {
      shown: true;
      pairs: number;
      accuracy: number;
      baseRate: number;
      band: OutcomeBand;
      agreement: { count: number; k: number };
      neighbours: (TrainingPair & { distance: number })[];
    };

/** Gate, then list the nearest promos and the band most of them landed in. The subject never counts as its own neighbour. */
export function similarOutcomes(subject: { id: string; vector: number[] | null; promoType: string | null }, allPairs: readonly TrainingPair[]): SimilarOutcome {
  const pairs = allPairs.filter((pair) => pair.id !== subject.id);
  if (!subject.vector) return { shown: false, reason: "This promo has no complete set of sub-scores yet. Analyze it first.", pairs: pairs.length };
  if (pairs.length < MIN_TRAINING_PAIRS) {
    return {
      shown: false,
      reason: `Needs ${MIN_TRAINING_PAIRS} promos with both an analysis and a real-world score; this brand has ${pairs.length}.`,
      pairs: pairs.length,
    };
  }
  const { accuracy, baseRate } = leaveOneOut(pairs);
  if (accuracy <= baseRate) {
    return {
      shown: false,
      reason: `Hidden: on this brand's data the method is right ${Math.round(accuracy * 100)}% of the time, no better than always guessing the most common outcome (${Math.round(baseRate * 100)}%).`,
      pairs: pairs.length,
      accuracy,
      baseRate,
    };
  }
  const neighbours = nearest({ id: subject.id, vector: subject.vector, promoType: subject.promoType }, pairs, kFor(pairs.length));
  const { band, count } = majorityBand(neighbours);
  return { shown: true, pairs: pairs.length, accuracy, baseRate, band, agreement: { count, k: neighbours.length }, neighbours };
}

// ---------------------------------------------------------------------------
// Calibration: AI score vs your score vs real-world score

export type CalibrationPoint = { id: string; title: string; ai: number; mine: number | null; real: number | null };

export function calibrationStats(points: readonly CalibrationPoint[]) {
  const gap = (key: "mine" | "real") => {
    const rows = points.filter((p) => p[key] != null);
    if (!rows.length) return null;
    const diffs = rows.map((p) => p.ai - p[key]!);
    const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    const abs = diffs.reduce((a, b) => a + Math.abs(b), 0) / diffs.length;
    return { n: rows.length, meanGap: Math.round(mean * 10) / 10, meanAbsGap: Math.round(abs * 10) / 10, correlation: correlation(rows.map((p) => p.ai), rows.map((p) => p[key]!)) };
  };
  return { mine: gap("mine"), real: gap("real") };
}

export function correlation(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i += 1) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return Math.round((sxy / Math.sqrt(sxx * syy)) * 100) / 100;
}
