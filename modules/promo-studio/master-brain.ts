/**
 * Promo Analyzer → Master Brain.
 *
 * Every analyzed promo, in whatever organization, must be in the Master Brain.
 * The analyzer teaches the brand Brain after each run (which learns up), but
 * promos analyzed before that existed, or in an organization that was later
 * deleted, never got there. These builders produce the same notes the analyzer
 * writes (review + copy), from a saved promo row, so a sync can fill the gaps.
 *
 * Pure: no database, no AI.
 */

import { readability } from "./analysis";
import { analysisDigest, brainNoteV2, isStoredV2, sourceCopyNote } from "./stored";

export type PromoForBrain = {
  id: string;
  title: string;
  sourceText: string;
  publisher: string | null;
  gurus: readonly string[];
  product: string | null;
  promoCode: string | null;
  effectivenessScore: number | null;
};

export type MasterBrainPromoNote = { sourceRef: string; title: string; body: string; folder: string };

/** sourceRef the analyzer uses for a promo's review note; the Master Brain key is learned:<org>:<this>. */
export function promoReviewRef(promoId: string): string {
  return `promo:${promoId}`;
}

export function promoCopyRef(promoId: string): string {
  return `promo-copy:${promoId}`;
}

function metaLines(promo: PromoForBrain, score: number | null): string[] {
  return [
    promo.publisher ? `Publisher: ${promo.publisher}` : "",
    promo.gurus.length ? `Editor: ${promo.gurus.join(", ")}` : "",
    promo.promoCode ? `Promo code: ${promo.promoCode}` : "",
    score != null ? `Analyzer score: ${score.toFixed(1)}/10` : "",
  ].filter(Boolean);
}

/** A review note for an old (version 1, JSON) analysis, from its digest. Null when the result is unreadable. */
export function legacyReviewNote(input: { title: string; brandName: string; result: unknown; analyzedAt: Date | null; meta: string[] }): { title: string; body: string } | null {
  const digest = analysisDigest(input.result, input.brandName);
  if (!digest) return null;
  const lines = [`# Promo review: ${input.title}`, "", `- Brand: ${input.brandName}`];
  if (input.analyzedAt) lines.push(`- Analyzed: ${input.analyzedAt.toISOString().slice(0, 10)}`);
  if (digest.final != null) lines.push(`- Score: ${digest.final.toFixed(1)}/10`);
  for (const m of input.meta) lines.push(`- ${m}`);
  const section = (heading: string, items: readonly string[]) => {
    const clean = items.map((item) => item.trim()).filter(Boolean);
    if (clean.length) lines.push("", `## ${heading}`, ...clean.map((item) => `- ${item}`));
  };
  if (digest.summary.trim()) lines.push("", "## Summary", digest.summary.trim());
  if (digest.headline.headline.trim()) {
    lines.push("", "## Headline");
    if (digest.headline.eyebrow) lines.push(`Eyebrow: ${digest.headline.eyebrow}`);
    lines.push(`Headline: ${digest.headline.headline}`);
    if (digest.headline.subhead) lines.push(`Subhead: ${digest.headline.subhead}`);
  }
  if (digest.bigIdea.trim()) lines.push("", "## Big idea", digest.bigIdea.trim());
  if (digest.offer.summary.trim() || digest.offer.product.trim()) {
    lines.push("", "## Offer");
    for (const [label, value] of [
      ["Product", digest.offer.product],
      ["Price", digest.offer.price],
      ["Term", digest.offer.term],
      ["Guarantee", digest.offer.guarantee],
      ["Urgency", digest.offer.urgency],
    ] as const)
      if (value.trim()) lines.push(`- ${label}: ${value.trim()}`);
    if (digest.offer.summary.trim()) lines.push("", digest.offer.summary.trim());
  }
  if (digest.scores.length) lines.push("", "## Scores", ...digest.scores.map((s) => `- ${s.name}: ${s.score}/10${s.note ? ` — ${s.note}` : ""}`));
  section("Strengths", digest.strengths);
  section("Fixes", digest.fixes);
  section("Lessons", digest.lessons);
  return { title: `Promo review: ${input.title}`, body: lines.join("\n") };
}

/**
 * The notes one promo should have in the Master Brain: its review (when it has
 * a usable analysis) and its copy (when it has text). Same titles, folders and
 * sourceRefs as the analyzer's own teach, so a later re-analysis refreshes them.
 */
export function promoMasterNotes(input: { promo: PromoForBrain; brandName: string; analysis: { result: unknown; createdAt: Date; score: number | null } | null }): MasterBrainPromoNote[] {
  const { promo, analysis } = input;
  const score = analysis?.score ?? promo.effectivenessScore;
  const out: MasterBrainPromoNote[] = [];
  if (analysis) {
    const meta = { publisher: promo.publisher, gurus: promo.gurus, product: promo.product, promoCode: promo.promoCode, analyzedAt: analysis.createdAt };
    const review = isStoredV2(analysis.result)
      ? brainNoteV2({ title: promo.title, brandName: input.brandName, stored: analysis.result, fk: readability(promo.sourceText), meta })
      : legacyReviewNote({ title: promo.title, brandName: input.brandName, result: analysis.result, analyzedAt: analysis.createdAt, meta: metaLines(promo, null).filter((m) => !m.startsWith("Analyzer score")) });
    if (review) out.push({ sourceRef: promoReviewRef(promo.id), title: review.title, body: review.body, folder: "Promo reviews" });
  }
  const copy = sourceCopyNote({ title: promo.title, text: promo.sourceText, meta: metaLines(promo, score) });
  if (copy) out.push({ sourceRef: promoCopyRef(promo.id), title: copy.title, body: copy.body, folder: "Promo copy" });
  return out;
}
