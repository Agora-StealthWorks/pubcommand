/**
 * Google Sheets and Airtable import sources. Pure: URL parsing, request URLs, turning API answers into a table
 * the import planner reads, and encrypting the person's own token at rest.
 *
 * A source is read into a header row + data rows and planned with planImportTable(), the same dry-run planner
 * as a pasted CSV. A re-sync only ever creates new recommendations or closes open ones; it never deletes or
 * rewrites what is already recorded.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export type SourceKind = "GSHEET" | "AIRTABLE";

export const SOURCE_LABELS: Record<SourceKind, string> = { GSHEET: "Google Sheet", AIRTABLE: "Airtable" };

/** docs.google.com/spreadsheets/d/<id>/edit#gid=<gid> → { sheetId, gid }. A bare id works too. */
export function parseSheetUrl(raw: string): { sheetId: string; gid: string | null } | null {
  const text = raw.trim();
  const match = text.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/);
  const sheetId = match ? match[1] : /^[A-Za-z0-9_-]{25,}$/.test(text) ? text : null;
  if (!sheetId) return null;
  const gid = text.match(/[#?&]gid=(\d+)/)?.[1] ?? null;
  return { sheetId, gid };
}

/** airtable.com/appXXX/tblYYY/viwZZZ → { baseId, tableId, viewId }. */
export function parseAirtableUrl(raw: string): { baseId: string; tableId: string | null; viewId: string | null } | null {
  const text = raw.trim();
  const baseId = text.match(/\b(app[A-Za-z0-9]{14})\b/)?.[1];
  if (!baseId) return null;
  return { baseId, tableId: text.match(/\b(tbl[A-Za-z0-9]{14})\b/)?.[1] ?? null, viewId: text.match(/\b(viw[A-Za-z0-9]{14})\b/)?.[1] ?? null };
}

/** CSV export of a tab of a sheet shared "anyone with the link can view" (no token needed). */
export function sheetCsvUrl(sheetId: string, gid: string | null): string {
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/export?format=csv${gid ? `&gid=${encodeURIComponent(gid)}` : ""}`;
}

/** Sheets API v4 values (needs the person's API key; the range names the tab, e.g. "Closed!A:Z"). */
export function sheetValuesUrl(sheetId: string, range: string, apiKey: string): string {
  return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}?key=${encodeURIComponent(apiKey)}&valueRenderOption=FORMATTED_VALUE`;
}

/** One page of Airtable records, every cell as a string. */
export function airtableListUrl(input: { baseId: string; table: string; view?: string | null; offset?: string | null }): string {
  const params = new URLSearchParams({ pageSize: "100", cellFormat: "string", timeZone: "America/New_York", userLocale: "en-us" });
  if (input.view) params.set("view", input.view);
  if (input.offset) params.set("offset", input.offset);
  return `https://api.airtable.com/v0/${encodeURIComponent(input.baseId)}/${encodeURIComponent(input.table)}?${params.toString()}`;
}

/** A cell from any API as text: arrays join with ", ", objects use their name. */
export function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(cellText).filter(Boolean).join(", ");
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    return cellText(v.name ?? v.text ?? v.value ?? "");
  }
  return "";
}

/** Airtable records → header + rows. Columns are every field name seen, in first-seen order. */
export function airtableTable(records: readonly { fields?: Record<string, unknown> }[]): string[][] {
  const header: string[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    for (const name of Object.keys(record.fields ?? {})) {
      if (!seen.has(name)) {
        seen.add(name);
        header.push(name);
      }
    }
  }
  if (!header.length) return [];
  return [header, ...records.map((record) => header.map((name) => cellText(record.fields?.[name]).slice(0, 4000)))];
}

/** Sheets API values → rows of strings (short rows padded). */
export function sheetValuesTable(values: unknown): string[][] {
  if (!Array.isArray(values)) return [];
  const rows = values.map((row) => (Array.isArray(row) ? row.map(cellText) : []));
  const width = Math.max(0, ...rows.map((row) => row.length));
  return rows.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill("")]).filter((row) => row.some((cell) => cell.trim() !== ""));
}

/** A short hint of a token for the UI: never the token itself. */
export function tokenHint(token: string): string {
  const text = token.trim();
  return text.length <= 8 ? "set" : `…${text.slice(-4)}`;
}

// ----------------------------------------------------------------------------- token encryption

function key(secret: string): Buffer {
  if (!secret || secret.length < 16) throw new Error("AUTH_SECRET must be set (16+ characters) to store import tokens.");
  return createHash("sha256").update(`pubcommand:trackrecord-import:${secret}`).digest();
}

/** AES-256-GCM, key derived from AUTH_SECRET. Output "v1.<iv>.<tag>.<ciphertext>" (base64url). */
export function encryptSecret(value: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptSecret(payload: string, secret: string): string {
  const [version, iv, tag, data] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unreadable stored token.");
  const decipher = createDecipheriv("aes-256-gcm", key(secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
