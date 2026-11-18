/**
 * What a saved analysis looks like, and the one adapter every reader uses.
 *
 * - Version 2 (now): the streamed answer cut into sections (`format: "sections"`),
 *   with the scorecard and the code-found attribution saved beside it. The
 *   sections are parsed on read, so parser fixes apply to old rows too.
 * - Version 1 (before November 2026): one JSON object (`PromoAnalysisResult`).
 *
 * Downstream code (insights, lessons, packager, similar promos, exports) reads
 * `analysisDigest(row.result)` and never cares which version it got.
 */

import { SUB_SCORES, promoTypeFromPrice, readingEaseLabel, type PromoAnalysisResult } from "./analysis";
import { headlinePrice, parseAnalysis, type ParsedAnalysis, type ParsedCubFlag, type PromoIntel } from "./parse";
import { DIMENSIONS, parseScorecard, type Scorecard } from "./score";
import { SECTION_KEYS, sectionTexts, splitSections, type SectionKey } from "./sections";
import type { DirectoryMatch } from "./prompt";

export const STORED_FORMAT = "sections" as const;

export type Reevaluation = {
  status: "RUNNING" | "DONE" | "FAILED";
  startedAt: string;
  /** The proposed scorecard text (DONE). */
  text?: string;
  error?: string;
};

export type StoredAnalysisV2 = {
  format: typeof STORED_FORMAT;
  version: 2;
  /** The full answer as the AI wrote it. */
  raw: string;
  sections: Partial<Record<SectionKey, string>>;
  /** Sections the answer never finished (ran out of room). */
  incomplete: SectionKey[];
  truncated: boolean;
  visual: boolean;
  /** Editors and publications code found in the copy before the call. */
  matches: DirectoryMatch[];
  /** The scorecard as first scored (the calibration baseline). */
  scorecard: Scorecard;
  /** A re-evaluation the publisher applied from the Training tab; it replaces the scorecard shown. */
  calibrated?: { text: string; appliedAt: string } | null;
  reevaluation?: Reevaluation | null;
};

export function isStoredV2(value: unknown): value is StoredAnalysisV2 {
  return Boolean(value && typeof value === "object" && (value as { format?: unknown }).format === STORED_FORMAT);
}

/** Build the row to save from the finished (or cut-off) answer. */
export function buildStored(input: { raw: string; finished: boolean; visual: boolean; matches: readonly DirectoryMatch[] }): StoredAnalysisV2 {
  const split = splitSections(input.raw, input.finished);
  const sections = sectionTexts(split);
  return {
    format: STORED_FORMAT,
    version: 2,
    raw: input.raw,
    sections,
    incomplete: SECTION_KEYS.filter((key) => !split[key]?.complete),
    truncated: !input.finished,
    visual: input.visual,
    matches: [...input.matches],
    scorecard: parseScorecard(split.SCORECARD?.complete ? split.SCORECARD.text : ""),
    calibrated: null,
    reevaluation: null,
  };
}

/** The scorecard shown: the applied re-evaluation when there is one, else the original. */
export function effectiveScorecard(stored: StoredAnalysisV2): Scorecard & { calibrated: boolean } {
  if (stored.calibrated?.text) {
    const card = parseScorecard(stored.calibrated.text);
    if (card.dimensions.length) return { ...card, calibrated: true };
  }
  return { ...stored.scorecard, calibrated: false };
}

export type AnalysisDigest = {
  version: 1 | 2;
  summary: string;
  bigIdea: string;
  headline: { eyebrow: string; headline: string; subhead: string };
  offer: { product: string; price: string; term: string; bonuses: string[]; guarantee: string; urgency: string; summary: string };
  /** The eight ratings under the canonical SUB_SCORES names (for similar-promo matching). */
  scores: { name: string; score: number; note: string }[];
  strengths: string[];
  fixes: string[];
  lessons: string[];
  compliance: { quote: string; rule: string; risk: "high" | "medium" | "low"; fix: string }[];
  cubCount: number;
  final: number | null;
  detected: { publisher: string; publisherInferred: boolean; gurus: string[]; product: string; pricePoint: number | null; promoType: string };
};

function digestV1(r: PromoAnalysisResult): AnalysisDigest {
  return {
    version: 1,
    summary: r.summary ?? "",
    bigIdea: r.sixteenWord?.bigIdea ?? "",
    headline: { eyebrow: r.headline?.eyebrow ?? "", headline: r.headline?.headline ?? "", subhead: r.headline?.subhead ?? "" },
    offer: {
      product: r.offer?.product ?? "",
      price: r.offer?.price ?? "",
      term: r.offer?.term ?? "",
      bonuses: r.offer?.bonuses ?? [],
      guarantee: r.offer?.guarantee ?? "",
      urgency: r.offer?.urgency ?? "",
      summary: r.offer?.summary ?? "",
    },
    scores: r.scores ?? [],
    strengths: r.strengths ?? [],
    fixes: r.fixes ?? [],
    lessons: r.lessons ?? [],
    compliance: r.compliance ?? [],
    cubCount: r.cub?.length ?? 0,
    final: null,
    detected: {
      publisher: r.detected?.publisher ?? "",
      publisherInferred: false,
      gurus: r.detected?.gurus ?? [],
      product: r.detected?.product ?? "",
      pricePoint: r.detected?.pricePoint ?? null,
      promoType: r.detected?.promoType ?? "Unknown",
    },
  };
}

/** Code-found attribution first; the AI's guess only fills what code did not find. */
export function detectedFrom(parsed: ParsedAnalysis, matches: readonly DirectoryMatch[], brandName: string): AnalysisDigest["detected"] {
  const matchedEditors = [...new Set(matches.flatMap((m) => (m.kind === "editor" ? [m.name] : [])))];
  const matchedPubs = [...new Set(matches.flatMap((m) => m.publications))];
  const price = headlinePrice(parsed.offer.prices);
  const aiExpert = parsed.intel?.expert?.name ?? "";
  return {
    publisher: matches.length ? brandName : parsed.offer.publisher,
    publisherInferred: matches.length ? false : parsed.offer.publisherInferred,
    gurus: matchedEditors.length ? matchedEditors : aiExpert ? [aiExpert] : [],
    product: matchedPubs.length === 1 ? matchedPubs[0]! : parsed.offer.product || matchedPubs[0] || "",
    pricePoint: price,
    promoType: promoTypeFromPrice(price) ?? "Unknown",
  };
}

function digestV2(stored: StoredAnalysisV2, brandName: string): AnalysisDigest {
  const parsed = parseAnalysis(stored.sections);
  const card = effectiveScorecard(stored);
  const byName = new Map(card.dimensions.map((d) => [d.name, d]));
  const scores = DIMENSIONS.flatMap((name, i) => {
    const d = byName.get(name);
    return d ? [{ name: SUB_SCORES[i]!, score: d.score, note: d.rationale }] : [];
  });
  const strong = parsed.sixteenWord.items.filter((i) => i.rating === "strong").map((i) => `${i.label}: ${i.note}`);
  const missing = parsed.sixteenWord.items.filter((i) => i.rating === "missing" && !(i.kind === "close" && i.number === 3)).map((i) => `${i.label}: ${i.note}`);
  const o = parsed.offer;
  return {
    version: 2,
    summary: [o.whatItIs && o.product ? `${o.product}: ${o.whatItIs}.` : "", card.rationale].filter(Boolean).join(" "),
    bigIdea: o.bigIdea,
    headline: { eyebrow: parsed.headline.eyebrow, headline: parsed.headline.headline, subhead: parsed.headline.subhead },
    offer: {
      product: o.product,
      price: o.prices,
      term: o.paymentOptions,
      bonuses: o.premiums,
      guarantee: o.guarantee,
      urgency: o.urgency,
      summary: [o.whatItIs, o.bigIdea].filter(Boolean).join(" "),
    },
    scores,
    strengths: [...card.dimensions.filter((d) => d.score >= 8).map((d) => `${d.name}: ${d.rationale}`), ...strong].slice(0, 8),
    fixes: [...missing, ...card.dimensions.filter((d) => d.score < 6).map((d) => `${d.name}: ${d.rationale}`)].slice(0, 8),
    lessons: [],
    compliance: [],
    cubCount: parsed.cub?.length ?? 0,
    final: card.final,
    detected: detectedFrom(parsed, stored.matches, brandName),
  };
}

/** One view over either saved shape. Null for anything unreadable. */
export function analysisDigest(result: unknown, brandName = ""): AnalysisDigest | null {
  if (!result || typeof result !== "object") return null;
  if (isStoredV2(result)) return digestV2(result, brandName);
  const v1 = result as PromoAnalysisResult;
  if (!v1.headline || !Array.isArray(v1.scores)) return null;
  return digestV1(v1);
}

// ---------------------------------------------------------------------------
// Brain notes and exports

const bullets = (items: readonly string[]) => (items.length ? items.map((i) => `- ${i}`) : ["- None noted."]);
const RATING_LABEL = { strong: "Strong", weak: "Present but weak", missing: "Missing" } as const;

/** The analysis as Markdown: the Brain note body and the Markdown export share it. */
export function analysisMarkdown(input: {
  title: string;
  brandName: string;
  stored: StoredAnalysisV2;
  fk: { ease: number; grade: number } | null;
  meta: { publisher?: string | null; gurus?: readonly string[]; product?: string | null; promoCode?: string | null; analyzedAt?: Date };
}): string {
  const p = parseAnalysis(input.stored.sections);
  const card = effectiveScorecard(input.stored);
  const h = p.headline;
  const lines: string[] = [`# Promo review: ${input.title}`, ""];
  lines.push(`- Brand: ${input.brandName}`);
  if (input.meta.analyzedAt) lines.push(`- Analyzed: ${input.meta.analyzedAt.toISOString().slice(0, 10)}`);
  if (card.final != null) lines.push(`- Score: ${card.final.toFixed(1)}/10${card.calibrated ? " (re-evaluated with publisher feedback)" : ""}`);
  if (input.fk) lines.push(`- Reading ease: ${input.fk.ease} (${readingEaseLabel(input.fk.ease)}) · grade ${input.fk.grade}`);
  if (input.meta.publisher) lines.push(`- Publisher: ${input.meta.publisher}`);
  if (input.meta.gurus?.length) lines.push(`- Editor: ${input.meta.gurus.join(", ")}`);
  if (input.meta.product) lines.push(`- Product: ${input.meta.product}`);
  if (input.meta.promoCode) lines.push(`- Promo code: ${input.meta.promoCode}`);
  if (input.stored.truncated) lines.push("- Note: the AI ran out of room before finishing; some sections are missing.");
  lines.push("", "## Headline");
  if (h.eyebrow) lines.push(`Eyebrow: ${h.eyebrow}`);
  lines.push(`Headline: ${h.headline || "(none)"}`);
  if (h.subhead) lines.push(`Subhead: ${h.subhead}`);
  for (const u of h.fourUs) lines.push(`- ${u.label}: ${u.rating ?? "?"} — ${u.note}`);
  if (h.verdict) lines.push("", h.verdict);
  lines.push("", "## Outline", ...(p.outline.length ? p.outline.map((o, i) => `${i + 1}. ${o.title}${o.purpose ? ` — ${o.purpose}` : ""}`) : ["(none)"]));
  lines.push("", "## 16-Word Sales Letter");
  for (const item of p.sixteenWord.items) lines.push(`- ${item.kind === "question" ? `Q${item.number}` : `C${item.number}`} ${item.label} — ${item.rating ? RATING_LABEL[item.rating] : "?"}: ${item.note}`);
  if (p.sixteenWord.verdict) lines.push("", p.sixteenWord.verdict);
  lines.push("", "## CUB review");
  if (p.cub === null) lines.push("(not available)");
  else if (!p.cub.length) lines.push("No lines flagged.");
  else for (const c of p.cub) lines.push(`- ${c.type.toUpperCase()}: "${c.text}" — ${c.reason}`);
  const o = p.offer;
  lines.push("", "## Offer");
  if (o.bigIdea) lines.push(`Big idea: ${o.bigIdea}`);
  lines.push(
    `- Publisher: ${o.publisher || "—"}${o.publisherInferred ? " (inferred, low confidence)" : ""}`,
    `- Product: ${o.product || "—"}`,
    `- What it is: ${o.whatItIs || "—"}`,
    `- Prices: ${o.prices || "—"}`,
    `- Payment options: ${o.paymentOptions || "—"}`,
    `- Premiums: ${o.premiums.length ? o.premiums.join("; ") : "—"}`,
    `- Guarantee: ${o.guarantee || "—"}`,
    `- Urgency: ${o.urgency || "—"}`,
  );
  lines.push("", "## Tease");
  if (!p.tease.present) lines.push("Nothing teased.");
  else {
    if (p.tease.subject) lines.push(`Teased: ${p.tease.subject}`);
    lines.push("Clues:", ...bullets(p.tease.clues), "Guesses (from clues, not facts):", ...bullets(p.tease.guesses));
    if (p.tease.confidence) lines.push(`Confidence: ${p.tease.confidence}`);
  }
  lines.push("", "## Score");
  for (const d of card.dimensions) lines.push(`- ${d.name}: ${d.score}/10 — ${d.rationale}`);
  if (card.adjustment) lines.push(`- Adjustment: ${card.adjustment.value > 0 ? "+" : ""}${card.adjustment.value} — ${card.adjustment.reason}`);
  if (card.final != null) lines.push(`- Final (weighted): ${card.final.toFixed(1)}/10`);
  if (card.rationale) lines.push("", card.rationale);
  return lines.join("\n");
}

/** The brand Brain note for one analysis. */
export function brainNoteV2(input: Parameters<typeof analysisMarkdown>[0]): { title: string; body: string } {
  return { title: `Promo review: ${input.title}`, body: analysisMarkdown(input) };
}

/** Facts the promo states about its expert, product and publication, as a Brain note. Null when there is nothing. */
export function intelNote(input: { title: string; intel: PromoIntel | null; score: number | null; analyzedAt: Date }): { title: string; body: string } | null {
  const i = input.intel;
  if (!i) return null;
  const facts = [
    i.expert?.backstory.length,
    i.expert?.credentials.length,
    i.product?.proof.length,
    i.strategies.length,
    i.topics.length,
    i.beliefs.length,
    i.notableFacts.length,
  ].some(Boolean) || i.expert?.name || i.product?.name;
  if (!facts) return null;
  const lines = [
    `# Promo facts: ${input.title}`,
    "",
    "What this promo claims, as written. Claims are not verified.",
    `- From: ${input.title} · ${input.analyzedAt.toISOString().slice(0, 10)}${input.score != null ? ` · score ${input.score.toFixed(1)}/10` : ""}`,
    "",
  ];
  if (i.expert) {
    lines.push(`## Expert: ${i.expert.name ?? "unnamed"}`);
    if (i.expert.approach) lines.push(`Approach: ${i.expert.approach}`);
    if (i.expert.credibility) lines.push(`Credibility in this promo: ${i.expert.credibility}`);
    lines.push("Backstory claims:", ...bullets(i.expert.backstory), "Credentials claimed:", ...bullets(i.expert.credentials), "");
  }
  if (i.product) {
    lines.push(`## Product: ${i.product.name ?? "unnamed"}${i.product.type ? ` (${i.product.type})` : ""}`);
    if (i.product.offers) lines.push(`What the buyer gets: ${i.product.offers}`);
    if (i.product.mechanism) lines.push(`Mechanism: ${i.product.mechanism}`);
    if (i.product.promise) lines.push(`Promise: ${i.product.promise}`);
    if (i.product.backtests) lines.push(`Backtests cited: ${i.product.backtests}`);
    lines.push("Proof used:", ...bullets(i.product.proof), "");
  }
  if (i.publication) lines.push(`Publication: ${i.publication}`, "");
  const list = (heading: string, items: readonly string[]) => (items.length ? [`## ${heading}`, ...bullets(items), ""] : []);
  lines.push(
    ...list("Strategies", i.strategies),
    ...list("Topics", i.topics),
    ...list("Beliefs", i.beliefs),
    ...list("Other products named", i.otherProducts),
    ...list("Audience signals", i.audienceSignals),
    ...list("Other facts", i.notableFacts),
  );
  return { title: `Promo facts: ${input.title}`, body: lines.join("\n").trim() };
}

/** The promo's own copy as a Brain note (so the Brain can quote it later). Null for scanned PDFs with no text. */
export function sourceCopyNote(input: { title: string; text: string; meta: string[] }): { title: string; body: string } | null {
  if (!input.text.trim()) return null;
  return { title: `Promo copy: ${input.title}`, body: [`# Promo copy: ${input.title}`, "", ...input.meta.map((m) => `- ${m}`), "", input.text.trim()].join("\n") };
}

/** CUB flags as the shape `locateCub` takes. */
export function cubQuotes(flags: readonly ParsedCubFlag[]): { quote: string }[] {
  return flags.map((f) => ({ quote: f.text }));
}

