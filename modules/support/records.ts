/**
 * Pure record logic: validation, the text the gate reads, and chunking for search.
 * The write path (features/support/records.ts) is: validateRecord → checkContent →
 * revision → save → reindex. Nothing reaches the search index without passing here.
 */
import { checkContent, cleanOverrides, gateMessage, type GateResult } from "./gate";
import { isAudience, isRecordCategory, isStatus, type Audience, type Category, type RecordStatus } from "./taxonomy";

export const LIMITS = { title: 300, body: 50_000, summary: 2_000, tag: 60, tags: 30, url: 1_000 } as const;

export type RecordInput = {
  category: Category;
  audience: Audience;
  status: RecordStatus;
  title: string;
  body: string;
  summary: string;
  url: string | null;
  tags: string[];
  publicationCodes: string[];
  gateOverrides: string[];
};

export type ValidationResult = { ok: true; data: RecordInput } | { ok: false; error: string };

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, max) : "";
}

/** Split a comma or newline list into clean unique items. */
export function listOf(value: unknown, max: number = LIMITS.tags, itemMax: number = LIMITS.tag): string[] {
  const parts = Array.isArray(value) ? value.map((v) => String(v)) : typeof value === "string" ? value.split(/[,\n;]/) : [];
  return [...new Set(parts.map((p) => p.trim().slice(0, itemMax)).filter(Boolean))].slice(0, max);
}

/** An https (or http) URL, or null. Anything else is rejected by the caller. */
export function cleanUrl(value: unknown): string | null | "invalid" {
  const raw = text(value, LIMITS.url);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "invalid";
  } catch {
    return "invalid";
  }
}

export function validateRecord(raw: Record<string, unknown>): ValidationResult {
  if (!isRecordCategory(raw.category)) return { ok: false, error: "Pick a category." };
  if (!isAudience(raw.audience)) return { ok: false, error: "Pick who may hear this: public or members only." };
  const status = isStatus(raw.status) ? raw.status : "draft";
  const title = text(raw.title, LIMITS.title);
  if (!title) return { ok: false, error: "A title is required." };
  const body = text(raw.body, LIMITS.body);
  if (!body) return { ok: false, error: "Write the answer the agent may give." };
  const url = cleanUrl(raw.url);
  if (url === "invalid") return { ok: false, error: "The link must be a full http(s):// URL." };
  return {
    ok: true,
    data: {
      category: raw.category,
      audience: raw.audience,
      status,
      title,
      body,
      summary: text(raw.summary, LIMITS.summary),
      url,
      tags: listOf(raw.tags),
      publicationCodes: listOf(raw.publicationCodes, 20, 40).map((code) => code.toUpperCase()),
      gateOverrides: cleanOverrides(Array.isArray(raw.gateOverrides) ? raw.gateOverrides : []),
    },
  };
}

/** Everything a customer could hear from this record, as one text for the gate. */
export function gateText(record: Pick<RecordInput, "title" | "body" | "summary" | "tags"> & { url?: string | null }): string {
  return [record.title, record.summary, record.body, record.tags.join(", ")].filter(Boolean).join("\n");
}

export type PublishDecision = { ok: true; gate: GateResult } | { ok: false; gate: GateResult; error: string };

/**
 * May this record be saved with its requested status? Drafts always save (the hits are
 * shown); publishing needs a clean gate, and a price needs a person's confirmation.
 */
export function publishDecision(record: RecordInput, extra: { priceConfirmed?: boolean } = {}): PublishDecision {
  const gate = checkContent(gateText(record), record.gateOverrides);
  if (record.status !== "published") return { ok: true, gate };
  if (!gate.ok) return { ok: false, gate, error: gateMessage(gate) };
  if (record.category === "pricing" && !extra.priceConfirmed) {
    return { ok: false, gate, error: "A price stays a draft until someone with publish rights confirms it is the current retail list price." };
  }
  return { ok: true, gate };
}

/** Plain text for search and voice: no Markdown emphasis, links or headings. */
export function toPlain(markdown: string): string {
  return markdown
    .replace(/\u0000/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/[*_]{1,3}([^*_\n]+)[*_]{1,3}/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/[ \t]+$/gm, "");
}

const PASSAGE = 1100;

/** Passages of about one spoken answer each, split on paragraphs then sentences. */
export function chunkText(input: string, target = PASSAGE): string[] {
  const paragraphs = toPlain(input).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let current = "";
  const push = () => {
    if (current) out.push(current);
    current = "";
  };
  for (const paragraph of paragraphs) {
    if (paragraph.length > target * 1.5) {
      for (const sentence of paragraph.split(/(?<=[.!?])\s+/)) {
        if (current && current.length + sentence.length + 1 > target) push();
        current = current ? `${current} ${sentence}` : sentence;
      }
      continue;
    }
    if (current && current.length + paragraph.length + 2 > target) push();
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  push();
  return out;
}

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "record"
  );
}
