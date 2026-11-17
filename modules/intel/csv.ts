/**
 * CSV exports of competitor emails and videos with their extractions. Pure.
 * Cells that a spreadsheet would run as a formula (=, +, -, @, tab, CR) get a
 * leading apostrophe, because the text comes from competitors' emails.
 */
import type { EmailExtraction } from "./extraction";

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.join("; ") : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  // A BOM so Excel reads UTF-8.
  return `﻿${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

const EXTRACTION_COLUMNS = [
  "type",
  "headline",
  "big_idea",
  "hook",
  "product",
  "offer",
  "price_as_stated",
  "discount",
  "guarantee",
  "experts",
  "cta",
  "urgency",
  "urgency_tactics",
  "deadline",
  "landing_url",
  "angles",
  "topics",
  "summary",
  "takeaway",
] as const;

function extractionCells(e: EmailExtraction | null, fallbackLanding: string | null): unknown[] {
  if (!e) return [null, null, null, null, null, null, null, null, null, null, null, null, null, null, fallbackLanding, null, null, null, null];
  return [
    e.type,
    e.headline,
    e.bigIdea,
    e.hook,
    e.product,
    e.offer,
    e.priceText,
    e.discount,
    e.guarantee,
    e.experts,
    e.cta,
    e.urgency.level,
    e.urgency.tactics,
    e.urgency.deadline,
    e.landingUrl ?? fallbackLanding,
    e.angles,
    e.topics,
    e.summary,
    e.takeaway,
  ];
}

export type EmailExportRow = {
  id: string;
  receivedAt: Date;
  competitor: string | null;
  list: string | null;
  fromName: string | null;
  fromAddress: string;
  subject: string;
  source: string;
  placement: string | null;
  landingUrl: string | null;
  landingTitle: string | null;
  extraction: EmailExtraction | null;
  link: string;
};

export const EMAIL_EXPORT_HEADER = ["received_at", "competitor", "list", "from_name", "from_address", "subject", "source", "placement", ...EXTRACTION_COLUMNS, "landing_title", "intel_link"];

export function emailExportCsv(rows: readonly EmailExportRow[]): string {
  return toCsv(
    EMAIL_EXPORT_HEADER,
    rows.map((row) => [
      row.receivedAt,
      row.competitor,
      row.list,
      row.fromName,
      row.fromAddress,
      row.subject,
      row.source,
      row.placement,
      ...extractionCells(row.extraction, row.landingUrl),
      row.landingTitle,
      row.link,
    ]),
  );
}

export type VideoExportRow = {
  id: string;
  createdAt: Date;
  competitor: string | null;
  title: string | null;
  url: string;
  platform: string | null;
  durationSec: number | null;
  status: string;
  transcriptSource: string | null;
  transcriptChars: number;
  extraction: EmailExtraction | null;
  link: string;
};

export const VIDEO_EXPORT_HEADER = ["captured_at", "competitor", "title", "url", "platform", "duration_sec", "status", "transcript_source", "transcript_chars", ...EXTRACTION_COLUMNS, "intel_link"];

export function videoExportCsv(rows: readonly VideoExportRow[]): string {
  return toCsv(
    VIDEO_EXPORT_HEADER,
    rows.map((row) => [
      row.createdAt,
      row.competitor,
      row.title,
      row.url,
      row.platform,
      row.durationSec,
      row.status,
      row.transcriptSource,
      row.transcriptChars,
      ...extractionCells(row.extraction, null),
      row.link,
    ]),
  );
}

export function exportFilename(kind: "emails" | "videos", brandName: string, now = new Date()): string {
  const brand = brandName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "brand";
  return `intel-${kind}-${brand}-${now.toISOString().slice(0, 10)}.csv`;
}
