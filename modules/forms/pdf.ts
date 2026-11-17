/**
 * PDF reports without a dependency: a small PDF 1.4 writer (standard
 * Helvetica fonts, WinAnsi text, filled rectangles) and the two documents
 * built on it:
 *
 *  - resultsPdf: the whole form's figures, one bar chart per question, plus
 *    the AI summary when there is one. Aggregates only, never written answers.
 *  - responsePdf: one respondent's answers (admin tier only, it is PII).
 *
 * Pure: bytes in, bytes out, unit tested.
 */
import type { FieldStats, FormStats } from "./analytics";
import { answerText, capturesAnswer, fieldSpec } from "./fields";
import type { FormSummaryResult } from "./summary";
import type { FieldDef, ResponseRecord } from "./types";

// --- Low-level writer ----------------------------------------------------

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 48;

/** Helvetica advance widths (1/1000 em) for ASCII 32..126. */
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667,
  722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556,
  278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** Unicode characters WinAnsi can show, mapped to their byte. Others become "?". */
const WIN_ANSI: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "‰": 0x89, "‹": 0x8b, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "™": 0x99, "›": 0x9b,
};

/** Text as WinAnsi bytes: Latin-1 passes through, typographic marks are mapped, anything else is "?". */
export function winAnsi(text: string): number[] {
  const out: number[] = [];
  for (const char of text.normalize("NFC")) {
    const code = char.codePointAt(0)!;
    if (code === 9) out.push(32);
    else if (code >= 32 && code <= 126) out.push(code);
    else if (code >= 160 && code <= 255) out.push(code);
    else if (WIN_ANSI[char] !== undefined) out.push(WIN_ANSI[char]!);
    else if (code === 10 || code === 13) continue;
    else out.push(63);
  }
  return out;
}

function pdfString(text: string): string {
  return `(${winAnsi(text)
    .map((byte) => {
      if (byte === 40 || byte === 41 || byte === 92) return `\\${String.fromCharCode(byte)}`;
      if (byte < 32 || byte > 126) return `\\${byte.toString(8).padStart(3, "0")}`;
      return String.fromCharCode(byte);
    })
    .join("")})`;
}

export function textWidth(text: string, size: number, bold = false): number {
  let units = 0;
  for (const byte of winAnsi(text)) units += byte >= 32 && byte <= 126 ? HELVETICA[byte - 32]! : 556;
  return (units / 1000) * size * (bold ? 1.06 : 1);
}

/** Greedy word wrap to a width in points. Long words are broken. */
export function wrapText(text: string, size: number, width: number, bold = false): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let piece = word;
      while (textWidth(piece, size, bold) > width) {
        let cut = piece.length - 1;
        while (cut > 1 && textWidth(piece.slice(0, cut), size, bold) > width) cut -= 1;
        if (line) {
          lines.push(line);
          line = "";
        }
        lines.push(piece.slice(0, cut));
        piece = piece.slice(cut);
      }
      const candidate = line ? `${line} ${piece}` : piece;
      if (textWidth(candidate, size, bold) <= width) line = candidate;
      else {
        if (line) lines.push(line);
        line = piece;
      }
    }
    lines.push(line);
  }
  return lines;
}

type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const value = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : "1d4ed8";
  return [0, 2, 4].map((start) => Math.round((parseInt(value.slice(start, start + 2), 16) / 255) * 1000) / 1000) as Rgb;
}

const INK: Rgb = [0.043, 0.071, 0.125];
const MUTED: Rgb = [0.357, 0.396, 0.467];
const TRACK: Rgb = [0.93, 0.94, 0.95];

/** A minimal page-based PDF builder. Coordinates: y grows DOWN from the top margin (converted on write). */
export class PdfDocument {
  private pages: string[][] = [];
  private y = MARGIN;
  readonly contentWidth = PAGE_W - MARGIN * 2;

  constructor() {
    this.addPage();
  }

  addPage() {
    this.pages.push([]);
    this.y = MARGIN;
  }

  get pageCount() {
    return this.pages.length;
  }

  /** Start a new page when fewer than `height` points remain. */
  ensure(height: number) {
    if (this.y + height > PAGE_H - MARGIN) this.addPage();
  }

  gap(points: number) {
    this.y += points;
  }

  private op(command: string) {
    this.pages.at(-1)!.push(command);
  }

  private fill([r, g, b]: Rgb) {
    return `${r} ${g} ${b} rg`;
  }

  /** Text at the cursor (or at x), wrapping to `width`; advances the cursor. */
  text(value: string, options: { size?: number; bold?: boolean; color?: Rgb; x?: number; width?: number; lineGap?: number } = {}) {
    const size = options.size ?? 10;
    const x = options.x ?? MARGIN;
    const width = options.width ?? this.contentWidth - (x - MARGIN);
    const leading = size * (options.lineGap ?? 1.3);
    for (const line of wrapText(value, size, width, options.bold)) {
      this.ensure(leading);
      const baseline = PAGE_H - (this.y + size);
      this.op(`BT /${options.bold ? "F2" : "F1"} ${size} Tf ${this.fill(options.color ?? INK)} ${x.toFixed(2)} ${baseline.toFixed(2)} Td ${pdfString(line)} Tj ET`);
      this.y += leading;
    }
  }

  /** One line of text at an absolute position on the current row (does not move the cursor). */
  label(value: string, x: number, rowY: number, options: { size?: number; bold?: boolean; color?: Rgb; align?: "left" | "right"; maxWidth?: number } = {}) {
    const size = options.size ?? 9;
    let text = value;
    if (options.maxWidth) {
      while (text.length > 1 && textWidth(text, size, options.bold) > options.maxWidth) text = text.slice(0, -1);
      if (text !== value) text = `${text.slice(0, -1)}…`;
    }
    const left = options.align === "right" ? x - textWidth(text, size, options.bold) : x;
    this.op(`BT /${options.bold ? "F2" : "F1"} ${size} Tf ${this.fill(options.color ?? INK)} ${left.toFixed(2)} ${(PAGE_H - (rowY + size)).toFixed(2)} Td ${pdfString(text)} Tj ET`);
  }

  rect(x: number, top: number, width: number, height: number, color: Rgb) {
    if (width <= 0 || height <= 0) return;
    this.op(`${this.fill(color)} ${x.toFixed(2)} ${(PAGE_H - top - height).toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f`);
  }

  rule(color: Rgb = TRACK) {
    this.ensure(8);
    this.rect(MARGIN, this.y, this.contentWidth, 0.8, color);
    this.y += 8;
  }

  get cursor() {
    return this.y;
  }

  set cursor(value: number) {
    this.y = value;
  }

  get left() {
    return MARGIN;
  }

  /** Serialize. Object 1 catalog, 2 pages, 3/4 fonts, then content+page pairs. */
  toBytes(meta: { title: string }): Uint8Array {
    const objects: string[] = [];
    const pageIds: number[] = [];
    const first = 5;
    this.pages.forEach((ops, index) => {
      const footer = `BT /F1 8 Tf ${this.fill(MUTED)} ${MARGIN} 24 Td ${pdfString(`Page ${index + 1} of ${this.pages.length}`)} Tj ET`;
      const stream = [...ops, footer].join("\n");
      const contentId = first + index * 2;
      const pageId = contentId + 1;
      pageIds.push(pageId);
      objects[contentId] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
      objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    });
    const infoId = first + this.pages.length * 2;
    objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
    objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
    objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
    objects[infoId] = `<< /Title ${pdfString(meta.title.slice(0, 200))} /Producer (PubCommand Forms) >>`;
    let body = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
    const offsets: number[] = [];
    for (let id = 1; id < objects.length; id += 1) {
      offsets[id] = Buffer.byteLength(body, "latin1");
      body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
    }
    const xref = Buffer.byteLength(body, "latin1");
    body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for (let id = 1; id < objects.length; id += 1) body += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
    body += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return new Uint8Array(Buffer.from(body, "latin1"));
  }
}

// --- Documents -------------------------------------------------------------

type Bar = { label: string; value: number; display: string };

/** Horizontal bar chart: label on the left, bar, figure on the right. */
function barChart(doc: PdfDocument, bars: Bar[], accent: Rgb, max = 100) {
  const labelWidth = 170;
  const figureWidth = 70;
  const barX = doc.left + labelWidth + 8;
  const barWidth = doc.contentWidth - labelWidth - figureWidth - 16;
  for (const bar of bars) {
    doc.ensure(16);
    const top = doc.cursor;
    doc.label(bar.label, doc.left, top + 1, { size: 9, maxWidth: labelWidth });
    doc.rect(barX, top + 2, barWidth, 8, TRACK);
    doc.rect(barX, top + 2, max > 0 ? Math.max(bar.value > 0 ? 1 : 0, (barWidth * Math.min(bar.value, max)) / max) : 0, 8, accent);
    doc.label(bar.display, doc.left + doc.contentWidth, top + 1, { size: 9, color: MUTED, align: "right" });
    doc.cursor = top + 15;
  }
}

function questionBlock(doc: PdfDocument, stats: FieldStats, accent: Rgb) {
  doc.ensure(60);
  doc.text(stats.label || "Untitled", { size: 11, bold: true });
  doc.text(`${stats.answered} of ${stats.base} answered · ${fieldSpec(stats.type)?.label ?? stats.type}`, { size: 8, color: MUTED });
  doc.gap(4);
  switch (stats.kind) {
    case "choice":
    case "multi":
    case "bool":
      if (stats.kind === "choice" && stats.free) {
        // Free values (hidden fields) can identify people; show only shared ones.
        const shared = stats.buckets.filter((bucket) => bucket.count >= 3);
        if (shared.length) barChart(doc, shared.map((bucket) => ({ label: bucket.label, value: bucket.pct, display: `${bucket.count} · ${bucket.pct}%` })), accent);
        else doc.text("No value shared by enough people to show.", { size: 9, color: MUTED });
      } else barChart(doc, stats.buckets.map((bucket) => ({ label: bucket.label, value: bucket.pct, display: `${bucket.count} · ${bucket.pct}%` })), accent);
      break;
    case "numeric": {
      const parts = [stats.nps ? `NPS ${stats.nps.score}` : "", `Average ${stats.mean ?? "–"}`, `Median ${stats.median ?? "–"}`, stats.min === null ? "" : `Range ${stats.min}–${stats.max}`].filter(Boolean);
      doc.text(parts.join("   ·   "), { size: 10 });
      if (stats.nps) doc.text(`Promoters ${stats.nps.promoters} · Passives ${stats.nps.passives} · Detractors ${stats.nps.detractors}`, { size: 8, color: MUTED });
      if (stats.buckets.length) {
        doc.gap(2);
        barChart(doc, stats.buckets.map((bucket) => ({ label: bucket.label, value: bucket.pct, display: `${bucket.count} · ${bucket.pct}%` })), accent);
      }
      break;
    }
    case "matrix":
      for (const row of stats.rows) {
        doc.ensure(30);
        doc.text(`${row.label} (${row.answered})`, { size: 9, bold: true });
        barChart(doc, row.buckets.map((bucket) => ({ label: `  ${bucket.label}`, value: bucket.pct, display: `${bucket.count} · ${bucket.pct}%` })), accent);
      }
      break;
    case "ranking": {
      const worst = Math.max(1, ...stats.items.map((item) => item.meanRank));
      doc.text("Average position (1 = top). Shorter bar ranks higher.", { size: 8, color: MUTED });
      barChart(doc, stats.items.map((item) => ({ label: item.label, value: item.meanRank, display: `avg ${item.meanRank} · 1st ${item.firstCount}` })), accent, worst);
      break;
    }
    case "date":
      doc.text(stats.earliest ? `${stats.earliest} to ${stats.latest}` : "No dates yet.", { size: 10 });
      break;
    case "text":
      doc.text("Written answers are not included in this report.", { size: 9, color: MUTED });
      break;
    case "file":
      doc.text("Uploads and signatures are not included in this report.", { size: 9, color: MUTED });
      break;
  }
  doc.gap(10);
}

function header(doc: PdfDocument, brandName: string, title: string, subtitle: string, accent: Rgb) {
  doc.rect(doc.left, doc.cursor, doc.contentWidth, 3, accent);
  doc.gap(12);
  doc.text(brandName, { size: 9, color: MUTED });
  doc.text(title, { size: 18, bold: true });
  doc.text(subtitle, { size: 9, color: MUTED });
  doc.gap(8);
}

export function resultsPdf(input: { formTitle: string; brandName: string; generatedAt: Date; stats: FormStats; summary: FormSummaryResult | null; accentColor: string }): Uint8Array {
  const doc = new PdfDocument();
  const accent = hexToRgb(input.accentColor);
  const { stats } = input;
  header(doc, input.brandName, `Results: ${input.formTitle}`, `Generated ${input.generatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC · complete, unflagged responses only`, accent);

  const tiles: [string, string][] = [
    ["Complete", String(stats.complete)],
    ["Partial", String(stats.partial)],
    ["Flagged", String(stats.flagged)],
    ["Completion", stats.completionRate === null ? "–" : `${stats.completionRate}%`],
    ["Median time", stats.medianSeconds === null ? "–" : `${stats.medianSeconds}s`],
  ];
  const tileWidth = (doc.contentWidth - 4 * 8) / 5;
  const top = doc.cursor;
  tiles.forEach(([label, value], index) => {
    const x = doc.left + index * (tileWidth + 8);
    doc.rect(x, top, tileWidth, 42, TRACK);
    doc.label(label, x + 8, top + 7, { size: 8, color: MUTED });
    doc.label(value, x + 8, top + 20, { size: 15, bold: true });
  });
  doc.cursor = top + 54;

  if (input.summary) {
    doc.text("AI summary", { size: 13, bold: true });
    doc.text("Built from the counts and averages only.", { size: 8, color: MUTED });
    doc.gap(3);
    if (input.summary.headline) doc.text(input.summary.headline, { size: 11, bold: true });
    for (const finding of input.summary.keyFindings) doc.text(`• ${finding}`, { size: 10, x: doc.left + 6 });
    if (input.summary.suggestedActions.length) {
      doc.gap(4);
      doc.text("Suggested actions", { size: 10, bold: true });
      for (const action of input.summary.suggestedActions) doc.text(`• ${action}`, { size: 10, x: doc.left + 6 });
    }
    if (input.summary.dataQuality.length) {
      doc.gap(4);
      doc.text("Caveats", { size: 10, bold: true });
      for (const item of input.summary.dataQuality) doc.text(`• ${item}`, { size: 9, color: MUTED, x: doc.left + 6 });
    }
    doc.gap(8);
  }

  doc.rule();
  doc.text("By question", { size: 13, bold: true });
  doc.gap(6);
  if (!stats.fields.length) doc.text("This form has no questions yet.", { size: 10, color: MUTED });
  for (const field of stats.fields) questionBlock(doc, field, accent);

  if (stats.dropOff.length) {
    doc.ensure(50);
    doc.text("Where people stopped", { size: 11, bold: true });
    doc.gap(4);
    const total = Math.max(1, stats.partial);
    barChart(doc, stats.dropOff.map((item) => ({ label: `Page ${item.page}`, value: (item.count / total) * 100, display: String(item.count) })), accent);
  }
  return doc.toBytes({ title: `Results: ${input.formTitle}` });
}

export function responsePdf(input: { formTitle: string; brandName: string; fields: readonly FieldDef[]; response: ResponseRecord; accentColor: string }): Uint8Array {
  const doc = new PdfDocument();
  const accent = hexToRgb(input.accentColor);
  const { response } = input;
  const status = response.status === "COMPLETE" ? `Completed ${response.completedAt?.toISOString().slice(0, 16).replace("T", " ") ?? ""} UTC` : `Partial (reached page ${response.lastPageIndex + 1})`;
  header(doc, input.brandName, input.formTitle, `Response ${response.id.slice(0, 8)} · ${status}${response.spamReason ? ` · flagged: ${response.spamReason}` : ""}`, accent);
  const questions = input.fields.filter((field) => capturesAnswer(field.type));
  for (const field of questions) {
    const value = response.answers[field.id];
    const text = answerText(field, value);
    doc.ensure(34);
    doc.text(field.label || "Untitled", { size: 10, bold: true });
    if (field.type === "ranking" || field.type === "matrix" || field.type === "matrix_multi") {
      const parts = text ? text.split("; ") : [];
      if (!parts.length) doc.text("No answer", { size: 10, color: MUTED });
      for (const part of parts) doc.text(part, { size: 10, x: doc.left + 8 });
    } else {
      doc.text(text || "No answer", { size: 10, color: text ? INK : MUTED });
    }
    doc.gap(6);
  }
  if (response.utm && Object.keys(response.utm).length) {
    doc.rule();
    doc.text("Link tags", { size: 10, bold: true });
    for (const [key, value] of Object.entries(response.utm)) doc.text(`${key}: ${value}`, { size: 9, color: MUTED });
  }
  return doc.toBytes({ title: `${input.formTitle} response` });
}

export function pdfFilename(title: string, suffix: string, now: Date): string {
  const safe = title.replace(/[^\w\- ]+/g, "").trim().slice(0, 80) || "form";
  return `${safe} ${suffix} ${now.toISOString().slice(0, 10)}.pdf`;
}
