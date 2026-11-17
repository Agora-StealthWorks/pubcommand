/**
 * Response exports: one row per response, one column per question, then
 * UTM and metadata. CSV and XLSX share the same rows. Values come from the
 * registry's toText, so every field type exports the same way everywhere.
 */
import { strToU8, zipSync } from "fflate";
import { answerText, capturesAnswer } from "./fields";
import { UTM_KEYS } from "./theme";
import type { FieldDef, ResponseRecord } from "./types";

export type ExportTable = { header: string[]; rows: string[][] };

function iso(date: Date | null): string {
  return date ? date.toISOString().replace("T", " ").slice(0, 19) : "";
}

/** Columns for every question that stores an answer, in form order. Duplicate labels get a number. */
export function exportColumns(fields: readonly FieldDef[]): { field: FieldDef; title: string }[] {
  const seen = new Map<string, number>();
  return fields
    .filter((field) => capturesAnswer(field.type))
    .map((field) => {
      const base = field.label.trim() || field.type;
      const count = (seen.get(base) ?? 0) + 1;
      seen.set(base, count);
      return { field, title: count > 1 ? `${base} (${count})` : base };
    });
}

export function buildExportTable(fields: readonly FieldDef[], responses: readonly ResponseRecord[]): ExportTable {
  const columns = exportColumns(fields);
  const header = ["Response ID", "Status", "Started (UTC)", "Completed (UTC)", "Seconds", ...columns.map((column) => column.title), ...UTM_KEYS, "Spam flag"];
  const rows = responses.map((response) => [
    response.id,
    response.status === "COMPLETE" ? "Complete" : "Partial",
    iso(response.startedAt),
    iso(response.completedAt),
    response.durationMs ? String(Math.round(response.durationMs / 1000)) : "",
    ...columns.map((column) => answerText(column.field, response.answers[column.field.id])),
    ...UTM_KEYS.map((key) => response.utm?.[key] ?? ""),
    response.spamReason ?? "",
  ]);
  return { header, rows };
}

/**
 * A cell a spreadsheet would run as a formula (=, +, -, @, tab, CR) is
 * prefixed with an apostrophe. Respondents type these cells, so this is a
 * real injection path, not a nicety.
 */
export function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function toCsv(table: ExportTable): string {
  const cell = (value: string) => {
    const safe = neutralizeFormula(value);
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  // BOM so Excel reads UTF-8.
  return `﻿${[table.header, ...table.rows].map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}

function xml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // XML 1.0 forbids most control characters.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

export function columnName(index: number): string {
  let name = "";
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/** A minimal, valid .xlsx: one sheet, inline strings, bold frozen header row. */
export function toXlsx(table: ExportTable, sheetName = "Responses"): Uint8Array {
  const all = [table.header, ...table.rows];
  const sheetRows = all
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          const ref = `${columnName(c)}${r + 1}`;
          const style = r === 0 ? ' s="1"' : "";
          return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(value.slice(0, 32000))}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  const width = table.header.map((_, c) => `<col min="${c + 1}" max="${c + 1}" width="${c < 5 ? 20 : 28}" customWidth="1"/>`).join("");
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${width}</cols><sheetData>${sheetRows}</sheetData></worksheet>`;
  const name = xml(sheetName.replace(/[[\]:*?/\\]/g, " ").slice(0, 31) || "Responses");
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    "xl/styles.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`,
    ),
    "xl/worksheets/sheet1.xml": strToU8(sheet),
  };
  return zipSync(files, { level: 6 });
}

export function exportFilename(title: string, extension: "csv" | "xlsx", now: Date): string {
  const safe = title.replace(/[^\w\- ]+/g, "").trim().slice(0, 80) || "form";
  return `${safe} responses ${now.toISOString().slice(0, 10)}.${extension}`;
}
