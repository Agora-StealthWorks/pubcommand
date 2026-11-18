/**
 * Turns each section's text into data for the results view, the Brain note and
 * the exports. Every parser is forgiving: markdown, odd dashes, a missing or
 * half-written section all give an empty result, never an exception.
 */

import { CLOSE_STEPS, SIXTEEN_WORD_QUESTIONS } from "./analysis";
import { parseScorecard, plainLine, type Scorecard } from "./score";
import type { SectionKey } from "./sections";

export type URating = "present" | "weak" | "absent";
export type ParsedHeadline = {
  eyebrow: string;
  headline: string;
  subhead: string;
  fourUs: { label: "Urgent" | "Unique" | "Ultra-specific" | "Useful"; rating: URating | null; note: string }[];
  verdict: string;
};
export type ParsedOutlineItem = { title: string; purpose: string };
export type Strength = "strong" | "weak" | "missing";
export type ParsedSixteenItem = { kind: "question" | "close"; number: number; label: string; rating: Strength | null; note: string };
export type ParsedSixteenWord = { items: ParsedSixteenItem[]; verdict: string };
export type CubType = "confusing" | "unbelievable" | "boring";
export type ParsedCubFlag = { text: string; type: CubType; reason: string };
export type ParsedOffer = {
  bigIdea: string;
  publisher: string;
  /** True when the AI labelled the publisher as its own low-confidence guess. */
  publisherInferred: boolean;
  product: string;
  whatItIs: string;
  prices: string;
  paymentOptions: string;
  premiums: string[];
  guarantee: string;
  urgency: string;
};
export type ParsedTease = { present: boolean; subject: string; clues: string[]; guesses: string[]; confidence: "high" | "medium" | "low" | null };
export type PromoIntel = {
  expert: { name: string | null; backstory: string[]; credentials: string[]; approach: string | null; credibility: string | null } | null;
  product: { name: string | null; type: string | null; offers: string | null; mechanism: string | null; promise: string | null; proof: string[]; backtests: string | null } | null;
  publication: string | null;
  strategies: string[];
  topics: string[];
  beliefs: string[];
  otherProducts: string[];
  audienceSignals: string[];
  notableFacts: string[];
};
export type ParsedAnalysis = {
  headline: ParsedHeadline;
  outline: ParsedOutlineItem[];
  sixteenWord: ParsedSixteenWord;
  /** Null when the CUB section is missing or not valid JSON. */
  cub: ParsedCubFlag[] | null;
  offer: ParsedOffer;
  tease: ParsedTease;
  intel: PromoIntel | null;
  scorecard: Scorecard;
};

const lines = (text: string) => text.split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim());

/** "Label: value" on one line, after markdown is stripped. Null when the line has no label. */
function labelled(line: string, maxLabel = 40): { label: string; value: string } | null {
  const clean = plainLine(line);
  const m = /^([^:]{1,80}?)\s*:\s*(.*)$/.exec(clean);
  if (!m || m[1]!.length > maxLabel) return null;
  return { label: m[1]!.trim().toLowerCase().replace(/\s*\([^)]*\)\s*$/, ""), value: m[2]!.trim() };
}

const U_LABELS = ["Urgent", "Unique", "Ultra-specific", "Useful"] as const;

function uRating(value: string): { rating: URating | null; note: string } {
  const m = /^\[?\s*(present|weak|absent|missing)\s*\]?\s*(?:[—:,.-]\s*)?(.*)$/i.exec(value.trim());
  if (!m) return { rating: null, note: value.trim() };
  const word = m[1]!.toLowerCase();
  return { rating: word === "missing" ? "absent" : (word as URating), note: m[2]!.trim() };
}

export function parseHeadline(text: string): ParsedHeadline {
  const out: ParsedHeadline = { eyebrow: "", headline: "", subhead: "", fourUs: [], verdict: "" };
  const verdict: string[] = [];
  let inVerdict = false;
  for (const line of lines(text)) {
    const pair = labelled(line);
    if (pair) {
      const l = pair.label;
      const u = U_LABELS.find((name) => l === name.toLowerCase() || l.replace(/[\s-]/g, "") === name.toLowerCase().replace(/[\s-]/g, ""));
      if (u) {
        if (!out.fourUs.some((item) => item.label === u)) out.fourUs.push({ label: u, ...uRating(pair.value) });
        inVerdict = false;
        continue;
      }
      if (l === "eyebrow" || l === "pre-head" || l === "kicker") { out.eyebrow ||= unquote(pair.value); inVerdict = false; continue; }
      if (l === "headline" || l === "main headline") { out.headline ||= unquote(pair.value); inVerdict = false; continue; }
      if (l === "subhead" || l === "subheadline" || l === "deck" || l === "sub-headline") { out.subhead ||= unquote(pair.value); inVerdict = false; continue; }
      if (l === "verdict" || l === "overall" || l === "headline verdict") { inVerdict = true; if (pair.value) verdict.push(pair.value); continue; }
    }
    if (inVerdict) verdict.push(plainLine(line));
  }
  out.fourUs.sort((a, b) => U_LABELS.indexOf(a.label) - U_LABELS.indexOf(b.label));
  out.verdict = verdict.join(" ").trim();
  if (/^(none|n\/a|—|-)$/i.test(out.eyebrow)) out.eyebrow = "";
  if (/^(none|n\/a|—|-)$/i.test(out.subhead)) out.subhead = "";
  return out;
}

function unquote(value: string): string {
  return value.replace(/^["“”']+|["“”']+$/g, "").trim();
}

export function parseOutline(text: string): ParsedOutlineItem[] {
  const items: ParsedOutlineItem[] = [];
  for (const line of lines(text)) {
    const clean = plainLine(line.replace(/^\s*\d+\s*[.)]\s*/, ""));
    if (!clean) continue;
    const m = /^(.+?)\s*(?:—|:|\s-\s)\s*(.+)$/.exec(clean);
    if (m) items.push({ title: unquote(m[1]!), purpose: m[2]!.trim() });
    else if (/^\s*\d+\s*[.)]/.test(line) || items.length === 0) items.push({ title: unquote(clean), purpose: "" });
    else items[items.length - 1]!.purpose = `${items[items.length - 1]!.purpose} ${clean}`.trim();
  }
  return items;
}

function strength(word: string): Strength | null {
  const w = word.toLowerCase();
  if (w.startsWith("strong")) return "strong";
  if (w.includes("weak") || w.startsWith("present")) return "weak";
  if (w.startsWith("missing") || w.startsWith("absent")) return "missing";
  return null;
}

// "Q3 — Present but weak — why", "Q3: Strong: why", "C8 [Missing] why".
const SIXTEEN_LINE = /^(Q|C)\s*(\d{1,2})\s*(?:[.:—)]|\s)\s*\[?\s*(strong|present but weak|weak|present|missing|absent)\s*\]?\s*(?:[—:.,]\s*)?(.*)$/i;

export function parseSixteenWord(text: string): ParsedSixteenWord {
  const items: ParsedSixteenItem[] = [];
  const verdict: string[] = [];
  let inVerdict = false;
  let last: ParsedSixteenItem | null = null;
  for (const line of lines(text)) {
    const clean = plainLine(line);
    const m = SIXTEEN_LINE.exec(clean);
    if (m) {
      const kind = m[1]!.toUpperCase() === "Q" ? "question" : "close";
      const number = Number(m[2]);
      const list = kind === "question" ? SIXTEEN_WORD_QUESTIONS : CLOSE_STEPS;
      if (number >= 1 && number <= list.length && !items.some((i) => i.kind === kind && i.number === number)) {
        last = { kind, number, label: list[number - 1]!, rating: strength(m[3]!), note: m[4]!.trim() };
        items.push(last);
      }
      inVerdict = false;
      continue;
    }
    const v = /^(?:verdict|overall(?: verdict)?)\s*:\s*(.*)$/i.exec(clean);
    if (v) {
      inVerdict = true;
      last = null;
      if (v[1]) verdict.push(v[1].trim());
      continue;
    }
    if (inVerdict) verdict.push(clean);
    else if (last && clean && !/^(questions|close|the close|the 10 questions)\b/i.test(clean)) last.note = `${last.note} ${clean}`.trim();
  }
  items.sort((a, b) => (a.kind === b.kind ? a.number - b.number : a.kind === "question" ? -1 : 1));
  return { items, verdict: verdict.join(" ").trim() };
}

const CUB_TYPES: readonly CubType[] = ["confusing", "unbelievable", "boring"];

/** The first JSON value of the wanted kind in the text (fences and chatter around it are ignored). */
function jsonValue(text: string, open: "[" | "{"): unknown {
  const body = text.replace(/```(?:json)?/gi, "").trim();
  const close = open === "[" ? "]" : "}";
  const start = body.indexOf(open);
  const end = body.lastIndexOf(close);
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

export function parseCub(text: string): ParsedCubFlag[] | null {
  if (!text.trim()) return null;
  if (/^\s*(none|\[\s*\])\s*$/i.test(text)) return [];
  const parsed = jsonValue(text, "[");
  let value: unknown[];
  if (Array.isArray(parsed)) value = parsed;
  else {
    // Broken array (cut off, or one bad item): keep every complete flag object that still parses.
    const salvaged = [...text.matchAll(/\{[^{}]*\}/g)].flatMap((m) => {
      try {
        return [JSON.parse(m[0]) as unknown];
      } catch {
        return [];
      }
    });
    if (!salvaged.length) return null;
    value = salvaged;
  }
  const out: ParsedCubFlag[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const quote = typeof row.text === "string" ? row.text : typeof row.quote === "string" ? row.quote : "";
    const type = typeof row.type === "string" ? row.type.toLowerCase().trim() : "";
    if (!quote.trim() || !(CUB_TYPES as readonly string[]).includes(type)) continue;
    const reason = typeof row.reason === "string" ? row.reason : typeof row.why === "string" ? row.why : "";
    out.push({ text: quote.trim(), type: type as CubType, reason: reason.trim() });
  }
  return out;
}

type OfferField = Exclude<keyof ParsedOffer, "publisherInferred">;
const OFFER_FIELDS: [OfferField, RegExp][] = [
  ["bigIdea", /^big idea$/],
  ["publisher", /^publisher/],
  ["product", /^product( name)?$/],
  ["whatItIs", /^what it is/],
  ["prices", /^prices?|^price\(s\)/],
  ["paymentOptions", /^payment/],
  ["premiums", /^(premiums|bonuses|free bonuses|bonus reports)/],
  ["guarantee", /^guarantee/],
  ["urgency", /urgency|scarcity/],
];

export const INFERRED_MARK = /\(?\s*(?:inferred|guess|low confidence)[^)]*\)?/i;

export function parseOffer(text: string): ParsedOffer {
  const out: ParsedOffer = { bigIdea: "", publisher: "", publisherInferred: false, product: "", whatItIs: "", prices: "", paymentOptions: "", premiums: [], guarantee: "", urgency: "" };
  let current: OfferField | null = null;
  for (const line of lines(text)) {
    const pair = labelled(line, 45);
    const field = pair ? OFFER_FIELDS.find(([, re]) => re.test(pair.label))?.[0] ?? null : null;
    if (pair && field) {
      current = field;
      if (field === "premiums") {
        if (pair.value && !/^(none|n\/a|—)$/i.test(pair.value)) out.premiums.push(...pair.value.split(/\s*;\s*/).filter(Boolean));
      } else {
        out[field] = pair.value;
      }
      continue;
    }
    const clean = plainLine(line);
    if (!current || !clean) continue;
    if (current === "premiums") out.premiums.push(clean);
    else out[current] = `${out[current]} ${clean}`.trim();
  }
  if (INFERRED_MARK.test(out.publisher)) {
    out.publisherInferred = true;
    out.publisher = out.publisher.replace(INFERRED_MARK, "").replace(/[\s—,;-]+$/, "").trim();
  }
  out.premiums = out.premiums.map((p) => unquote(p)).filter((p) => p && !/^(none|n\/a)$/i.test(p));
  return out;
}

export function parseTease(text: string): ParsedTease {
  const empty: ParsedTease = { present: false, subject: "", clues: [], guesses: [], confidence: null };
  if (!text.trim() || /^\s*(none|no tease)[.!]?\s*$/i.test(plainLine(text))) return empty;
  const out: ParsedTease = { ...empty, present: true, clues: [], guesses: [] };
  let current: "clues" | "guesses" | null = null;
  for (const line of lines(text)) {
    const pair = labelled(line);
    if (pair) {
      if (/^(teased|what is teased|subject|teases)/.test(pair.label)) { out.subject = pair.value; current = null; continue; }
      if (/^clues?/.test(pair.label)) { current = "clues"; if (pair.value) out.clues.push(pair.value); continue; }
      if (/^(best )?guess|prediction/.test(pair.label)) { current = "guesses"; if (pair.value) out.guesses.push(pair.value); continue; }
      if (/^confidence/.test(pair.label)) {
        const c = pair.value.toLowerCase();
        out.confidence = c.startsWith("high") ? "high" : c.startsWith("med") ? "medium" : c.startsWith("low") ? "low" : null;
        current = null;
        continue;
      }
    }
    const clean = plainLine(line);
    if (current && clean) out[current].push(clean);
  }
  return out;
}

const strList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && Boolean(v.trim())).map((v) => v.trim()) : [];
const strOrNull = (value: unknown): string | null => (typeof value === "string" && value.trim() && !/^null$/i.test(value.trim()) ? value.trim() : null);

export function parseIntel(text: string): PromoIntel | null {
  if (!text.trim()) return null;
  const value = jsonValue(text, "{");
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const expertRaw = (v.expert ?? v.guru) as Record<string, unknown> | null | undefined;
  const productRaw = v.product as Record<string, unknown> | null | undefined;
  const expert =
    expertRaw && typeof expertRaw === "object"
      ? {
          name: strOrNull(expertRaw.name),
          backstory: strList(expertRaw.backstory ?? expertRaw.backstory_claims),
          credentials: strList(expertRaw.credentials ?? expertRaw.credentials_claimed),
          approach: strOrNull(expertRaw.approach),
          credibility: strOrNull(expertRaw.credibility ?? expertRaw.credibility_read),
        }
      : null;
  const product =
    productRaw && typeof productRaw === "object"
      ? {
          name: strOrNull(productRaw.name),
          type: strOrNull(productRaw.type),
          offers: strOrNull(productRaw.offers ?? productRaw.what_it_offers),
          mechanism: strOrNull(productRaw.mechanism),
          promise: strOrNull(productRaw.promise),
          proof: strList(productRaw.proof ?? productRaw.proof_elements),
          backtests: strOrNull(productRaw.backtests),
        }
      : null;
  return {
    expert,
    product,
    publication: strOrNull(v.publication),
    strategies: strList(v.strategies),
    topics: strList(v.topics),
    beliefs: strList(v.beliefs),
    otherProducts: strList(v.other_products ?? v.otherProducts),
    audienceSignals: strList(v.audience_signals ?? v.audienceSignals),
    notableFacts: strList(v.notable_facts ?? v.notableFacts),
  };
}

/** Parse every section. Missing sections parse to their empty value. */
export function parseAnalysis(sections: Partial<Record<SectionKey, string>>): ParsedAnalysis {
  const get = (key: SectionKey) => sections[key] ?? "";
  return {
    headline: parseHeadline(get("HEADLINE")),
    outline: parseOutline(get("OUTLINE")),
    sixteenWord: parseSixteenWord(get("SIXTEEN_WORD")),
    cub: parseCub(get("CUB")),
    offer: parseOffer(get("OFFER")),
    tease: parseTease(get("TEASE")),
    intel: parseIntel(get("INTEL")),
    scorecard: parseScorecard(get("SCORECARD")),
  };
}

/** The first dollar figure in the offer's prices (the headline price), or null. */
export function headlinePrice(prices: string): number | null {
  const m = /\$\s*([\d,]+(?:\.\d{1,2})?)/.exec(prices);
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}
