/**
 * AI read of a call's backup files: the prompt, the JSON schema, and the mapping from the model's answer to a
 * proposal a person reviews. Pure.
 *
 * The AI transcribes and proposes. It never supplies facts:
 *   - Any price it reads (entry, target, exit) is labelled "read from the document" and listed in
 *     `priceFields`, so the form and the call page ask a person to check it against the backup.
 *   - It never supplies a gain, a current price, a peak or a return. Those keys are not in the schema, and
 *     `mapProposal` drops anything it does not know. Gains come only from market data via computeGain().
 *   - Nothing is applied on its own: a person opens the form with the proposal filled in and saves it.
 */
import { CALL_TYPES, normalizeTicker, type CallType } from "./archive";
import { parseDate } from "./positions";

export const MAX_TRANSCRIPT_CHARS = 60_000;

export function backupReadSystem(brandContext: string): string {
  return [
    "You read the backup files of one documented market call (screenshots, PDFs, newsletter pages, video or audio transcripts) for an internal archive.",
    "",
    "Do two things:",
    "1. Transcribe each file faithfully into plain text: the words on the page or in the transcript, in reading order. Do not summarize, correct or add anything. Mark anything you cannot read as [unreadable].",
    "2. Propose the archive fields for the call, using only what the files say:",
    "   - ticker: the symbol the call is about, as written (no $). Null if none is named.",
    "   - direction: LONG for a buy/bullish call, SHORT for a sell/short/bearish call. Null if unclear.",
    "   - callDate: the date the call was made or published, YYYY-MM-DD. Null if the files do not show it. Never guess from today's date.",
    "   - entryPrice, targetPrice, exitPrice: prices exactly as written in the files. Null when not written. Never look up, estimate or compute a price.",
    "   - keyQuote: the one sentence that best states the call, copied word for word.",
    "   - title: a short neutral label such as \"Buy NVDA ahead of earnings\".",
    "   - callType: one of " + CALL_TYPES.join(", ") + ".",
    "   - source: where the call appeared (publication, show or event name) if the files say so.",
    "   - evidence: for each field you filled, the file number and a few words quoted from it.",
    "",
    "Never state a gain, a return, a current price or a peak: those are calculated later from market data.",
    "If the files are not about a market call, return nulls and say so in notes.",
    "",
    brandContext,
  ].join("\n");
}

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };
const nullableNumber = { anyOf: [{ type: "number" }, { type: "null" }] };

export const BACKUP_READ_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["files", "proposal", "evidence", "notes"],
  properties: {
    files: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["file", "transcript"],
        properties: { file: { type: "integer" }, transcript: { type: "string" } },
      },
    },
    proposal: {
      type: "object",
      additionalProperties: false,
      required: ["ticker", "direction", "callDate", "entryPrice", "targetPrice", "exitPrice", "keyQuote", "title", "callType", "source"],
      properties: {
        ticker: nullableString,
        direction: { anyOf: [{ type: "string", enum: ["LONG", "SHORT"] }, { type: "null" }] },
        callDate: nullableString,
        entryPrice: nullableNumber,
        targetPrice: nullableNumber,
        exitPrice: nullableNumber,
        keyQuote: nullableString,
        title: nullableString,
        callType: { anyOf: [{ type: "string", enum: [...CALL_TYPES] }, { type: "null" }] },
        source: nullableString,
      },
    },
    evidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "file", "quote"],
        properties: { field: { type: "string" }, file: { type: "integer" }, quote: { type: "string" } },
      },
    },
    notes: { type: "string" },
  },
} as const;

/** What the model returns (before mapping). Treated as untrusted. */
export type BackupReadRaw = {
  files?: { file?: unknown; transcript?: unknown }[];
  proposal?: Record<string, unknown>;
  evidence?: { field?: unknown; file?: unknown; quote?: unknown }[];
  notes?: unknown;
};

export const PRICE_FIELDS = ["entryPrice", "targetPrice", "exitPrice"] as const;
export type PriceField = (typeof PRICE_FIELDS)[number];
export const PRICE_FIELD_LABELS: Record<PriceField, string> = { entryPrice: "Entry price", targetPrice: "Target", exitPrice: "Exit price" };

/** A reviewed-by-nobody proposal, stored on the call as JSON. */
export type CallProposal = {
  ticker: string | null;
  direction: "LONG" | "SHORT" | null;
  callDate: string | null;
  entryPrice: number | null;
  targetPrice: number | null;
  exitPrice: number | null;
  keyQuote: string | null;
  title: string | null;
  callType: CallType | null;
  source: string | null;
  /** Price fields that were read from a document. Each needs a person to check it. */
  priceFields: PriceField[];
  evidence: { field: string; file: number; quote: string }[];
  notes: string;
  warnings: string[];
};

const str = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
};

function price(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/[$,\s]/g, "")) : Number.NaN;
  return Number.isFinite(n) && n > 0 && n < 10_000_000 ? Math.round(n * 1e6) / 1e6 : null;
}

/**
 * Turn the model's answer into a proposal. Unknown keys (gain, currentPrice, peak, …) are dropped, prices are
 * labelled as read from the document, a date in the future or unreadable is dropped.
 */
export function mapProposal(raw: BackupReadRaw | null | undefined, today: Date): CallProposal {
  const p = (raw?.proposal ?? {}) as Record<string, unknown>;
  const warnings: string[] = [];
  const tickerRaw = str(p.ticker, 30);
  const ticker = tickerRaw ? normalizeTicker(tickerRaw) || null : null;
  const direction = p.direction === "LONG" || p.direction === "SHORT" ? p.direction : null;
  let callDate: string | null = null;
  const dateText = str(p.callDate, 20);
  if (dateText) {
    const parsed = parseDate(dateText);
    if (parsed instanceof Date && parsed.getTime() <= today.getTime()) callDate = parsed.toISOString().slice(0, 10);
    else warnings.push(`The date "${dateText}" could not be used. Enter it from the backup.`);
  }
  const prices = {} as Record<PriceField, number | null>;
  const priceFields: PriceField[] = [];
  for (const field of PRICE_FIELDS) {
    prices[field] = price(p[field]);
    if (prices[field] != null) priceFields.push(field);
    else if (p[field] != null) warnings.push(`${PRICE_FIELD_LABELS[field]} "${String(p[field])}" is not a usable price.`);
  }
  const callType = (CALL_TYPES as readonly string[]).includes(String(p.callType)) ? (p.callType as CallType) : null;
  const evidence = (Array.isArray(raw?.evidence) ? raw.evidence : [])
    .map((e) => ({ field: str(e?.field, 40) ?? "", file: Number(e?.file) || 0, quote: str(e?.quote, 300) ?? "" }))
    .filter((e) => e.field && e.quote)
    .slice(0, 30);
  return {
    ticker,
    direction,
    callDate,
    entryPrice: prices.entryPrice,
    targetPrice: prices.targetPrice,
    exitPrice: prices.exitPrice,
    keyQuote: typeof p.keyQuote === "string" ? p.keyQuote.trim().slice(0, 4000) || null : null,
    title: str(p.title, 200),
    callType,
    source: str(p.source, 300),
    priceFields,
    evidence,
    notes: str(raw?.notes, 2000) ?? "",
    warnings,
  };
}

/** Transcripts per file number (1-based, as the files were given to the model). */
export function mapTranscripts(raw: BackupReadRaw | null | undefined, fileCount: number): Map<number, string> {
  const out = new Map<number, string>();
  for (const item of Array.isArray(raw?.files) ? raw.files : []) {
    const file = Number(item?.file);
    if (!Number.isInteger(file) || file < 1 || file > fileCount || typeof item?.transcript !== "string") continue;
    out.set(file, item.transcript.slice(0, MAX_TRANSCRIPT_CHARS));
  }
  return out;
}

/** Read a stored proposal back (it is JSON in the database). */
export function storedProposal(value: unknown): CallProposal | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<CallProposal>;
  if (!Array.isArray(v.priceFields)) return null;
  return v as CallProposal;
}

/**
 * Which price fields still need a person to check them after the form is saved: those the AI read and the
 * person saved unchanged. A price the person typed over is theirs.
 */
export function pricesToCheck(aiFields: readonly string[], proposal: CallProposal | null, submitted: Partial<Record<PriceField, number | null>>): PriceField[] {
  if (!proposal) return [];
  return PRICE_FIELDS.filter((field) => {
    if (!aiFields.includes(field) || !proposal.priceFields.includes(field)) return false;
    const value = submitted[field];
    return value != null && proposal[field] != null && Math.abs(value - (proposal[field] as number)) < 1e-9;
  });
}

// ----------------------------------------------------------------------------- input files

export type BackupKind = "pdf" | "image" | "text" | "docx" | "video" | "other";

export function backupKind(mime: string, filename: string): BackupKind {
  const name = filename.toLowerCase();
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (/^image\/(png|jpe?g)$/.test(mime) || /\.(png|jpe?g)$/.test(name)) return "image";
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || name.endsWith(".docx")) return "docx";
  if (mime.startsWith("text/") || /\.(txt|vtt|srt|md)$/.test(name)) return "text";
  if (mime.startsWith("video/") || mime.startsWith("audio/") || /\.(mp4|mov|webm|m4a|mp3|wav)$/.test(name)) return "video";
  return "other";
}

/** Strip WebVTT/SRT cue numbers and timestamps so a transcript reads as text. */
export function cleanTranscript(text: string): string {
  return text
    .replace(/^﻿/, "")
    .replace(/^WEBVTT.*$/m, "")
    .split(/\r?\n/)
    .filter((line) => !/^\d+$/.test(line.trim()) && !/-->/.test(line) && !/^NOTE\b/.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
