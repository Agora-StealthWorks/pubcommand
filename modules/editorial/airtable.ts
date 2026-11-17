/**
 * Optional two-way sync with a brand's own Airtable base.
 *
 * - Fields are mapped by Airtable field NAME, per table (events, issues).
 * - Write-back sends only mapped, editable fields: computed Airtable fields
 *   (formulas, rollups, lookups, created/modified times...) are never written.
 * - Pull upserts by Airtable record id. Postgres is the source of truth on a
 *   conflict, unless the Airtable record is newer (see pullDecision).
 * - The personal access token is stored encrypted with AUTH_SECRET.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { isDay } from "./dates";

export type SyncFieldType = "text" | "longtext" | "date" | "number" | "list" | "time";
export type SyncField = { key: string; label: string; type: SyncFieldType; guesses: string[] };

export const EVENT_SYNC_FIELDS: SyncField[] = [
  { key: "name", label: "Name", type: "text", guesses: ["Name", "Event", "Event Name", "Title"] },
  { key: "stage", label: "Stage", type: "text", guesses: ["Stage", "Status"] },
  { key: "eventType", label: "Event type", type: "text", guesses: ["Event Type", "Type", "Category"] },
  { key: "format", label: "Format", type: "text", guesses: ["Format", "Sales Type", "Subtype"] },
  { key: "marketingStart", label: "Marketing starts", type: "date", guesses: ["Marketing Start", "Marketing Start Date"] },
  { key: "eventDate", label: "Event date", type: "date", guesses: ["Event Date", "Date"] },
  { key: "eventEnd", label: "Event ends", type: "date", guesses: ["Event End", "Open House End", "End Date"] },
  { key: "marketingEnd", label: "Marketing ends", type: "date", guesses: ["Marketing End", "Marketing End Date"] },
  { key: "startTime", label: "Start time", type: "time", guesses: ["Start Time", "Time"] },
  { key: "channels", label: "Channels", type: "list", guesses: ["Channels", "Rooms", "Room", "Channel"] },
  { key: "hosts", label: "Hosts", type: "list", guesses: ["Hosts", "Host", "Speakers"] },
  { key: "offer", label: "Offer", type: "text", guesses: ["Offer"] },
  { key: "promoCode", label: "Promo code", type: "text", guesses: ["Promo Code", "Code"] },
  { key: "ctaLink", label: "Call-to-action link", type: "text", guesses: ["CTA Link", "CTA", "Link"] },
  { key: "registrationLink", label: "Registration link", type: "text", guesses: ["Registration Link", "Calendar Invite URL"] },
  { key: "replayLink", label: "Replay link", type: "text", guesses: ["Replay Link", "Replay"] },
  { key: "notes", label: "Notes", type: "longtext", guesses: ["Notes", "Description"] },
  { key: "peakAttendance", label: "Peak attendance", type: "number", guesses: ["Peak Attendance"] },
  { key: "avgAttendance", label: "Average attendance", type: "number", guesses: ["Avg Attendance", "Average Attendance"] },
  { key: "registrations", label: "Registrations", type: "number", guesses: ["Registrations"] },
  { key: "orders", label: "Orders", type: "number", guesses: ["Orders"] },
  { key: "revenue", label: "Revenue", type: "number", guesses: ["Revenue"] },
];

export const ISSUE_SYNC_FIELDS: SyncField[] = [
  { key: "title", label: "Title / topic", type: "text", guesses: ["Topic", "Title", "Name", "Subject"] },
  { key: "publicationCode", label: "Publication code", type: "text", guesses: ["List", "Publication", "Pub Code", "Code"] },
  { key: "mailDate", label: "Mail date", type: "date", guesses: ["Issue Date", "Mail Date", "Date", "Send Date"] },
  { key: "status", label: "Status", type: "text", guesses: ["Status", "Stage"] },
  { key: "issueType", label: "Type", type: "text", guesses: ["Editorial Type", "Type", "Issue Type"] },
  { key: "writer", label: "Writer", type: "text", guesses: ["Writer", "Author"] },
  { key: "subjectLines", label: "Subject lines", type: "list", guesses: ["Subject Lines", "Subject Line", "Subjects"] },
  { key: "tickers", label: "Tickers", type: "list", guesses: ["Tickers", "Ticker"] },
  { key: "offer", label: "Offer", type: "text", guesses: ["Offer", "Offer CTA", "Offer/CTA"] },
  { key: "websiteLink", label: "Web version link", type: "text", guesses: ["Website Link", "Web Link", "URL"] },
  { key: "ctaLink", label: "Call-to-action link", type: "text", guesses: ["Action Link", "CTA Link"] },
  { key: "notes", label: "Notes", type: "longtext", guesses: ["Notes", "Description"] },
];

export type SyncEntity = "event" | "issue";
export const SYNC_FIELDS: Record<SyncEntity, SyncField[]> = { event: EVENT_SYNC_FIELDS, issue: ISSUE_SYNC_FIELDS };

/** calendar field key → Airtable field name, plus the name of a "Last modified time" field. */
export type FieldMap = { fields: Record<string, string>; modifiedField: string | null; types: Record<string, string> };

export const EMPTY_MAP: FieldMap = { fields: {}, modifiedField: null, types: {} };

/** Read a stored map defensively (it is JSON in the database). */
export function readFieldMap(value: unknown): FieldMap {
  const v = (value && typeof value === "object" ? value : {}) as Partial<FieldMap>;
  const fields: Record<string, string> = {};
  for (const [k, name] of Object.entries(v.fields ?? {})) if (typeof name === "string" && name.trim()) fields[k] = name.trim();
  const types: Record<string, string> = {};
  for (const [k, t] of Object.entries(v.types ?? {})) if (typeof t === "string") types[k] = t;
  return { fields, modifiedField: typeof v.modifiedField === "string" && v.modifiedField.trim() ? v.modifiedField.trim() : null, types };
}

/** Guess a mapping from the table's field names (case-insensitive). */
export function guessFieldMap(entity: SyncEntity, airtableFields: string[]): Record<string, string> {
  const byLower = new Map(airtableFields.map((f) => [f.trim().toLowerCase(), f]));
  const used = new Set<string>();
  const out: Record<string, string> = {};
  for (const field of SYNC_FIELDS[entity]) {
    const hit = field.guesses.map((g) => byLower.get(g.toLowerCase())).find((name) => name && !used.has(name));
    if (hit) {
      out[field.key] = hit;
      used.add(hit);
    }
  }
  return out;
}

/** Airtable field types that are computed by Airtable and can never be written. */
export const COMPUTED_TYPES = new Set([
  "formula",
  "rollup",
  "lookup",
  "multipleLookupValues",
  "count",
  "createdTime",
  "lastModifiedTime",
  "autoNumber",
  "createdBy",
  "lastModifiedBy",
  "button",
  "externalSyncSource",
  "aiText",
]);

/** Is an Airtable field writable? Unknown types are treated as writable unless listed read-only. */
export function isEditable(name: string, map: FieldMap, readOnly: string[]): boolean {
  if (readOnly.some((r) => r.trim().toLowerCase() === name.toLowerCase())) return false;
  if (map.modifiedField && name === map.modifiedField) return false;
  const type = map.types[name];
  return !(type && COMPUTED_TYPES.has(type));
}

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

function toAirtableValue(value: unknown, type: SyncFieldType, airtableType: string | undefined): Json {
  if (value == null || value === "") return null;
  if (type === "list") {
    const list = (Array.isArray(value) ? value : [value]).map(String).filter(Boolean);
    if (airtableType === "multipleSelects") return list;
    return list.length ? list.join(airtableType === "multilineText" ? "\n" : ", ") : null;
  }
  if (type === "number") return typeof value === "number" && Number.isFinite(value) ? value : null;
  if (type === "date") return isDay(String(value)) ? String(value) : null;
  return String(value);
}

/**
 * The fields object for an Airtable create/update. Only mapped and editable
 * fields are included; each value is shaped to the Airtable field's type.
 */
export function toAirtableFields(entity: SyncEntity, record: Record<string, unknown>, map: FieldMap, readOnly: string[]): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const field of SYNC_FIELDS[entity]) {
    const name = map.fields[field.key];
    if (!name || !(field.key in record) || !isEditable(name, map, readOnly)) continue;
    out[name] = toAirtableValue(record[field.key], field.type, map.types[name]);
  }
  return out;
}

function textOf(value: unknown): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(", ") || null;
  if (typeof value === "object") {
    const v = value as { name?: unknown; email?: unknown; label?: unknown };
    return textOf(v.name ?? v.label ?? v.email ?? null);
  }
  const s = String(value).trim();
  return s || null;
}

function fromAirtableValue(value: unknown, type: SyncFieldType): unknown {
  if (type === "list") {
    if (value == null) return [];
    const parts = Array.isArray(value) ? value.map(textOf) : String(textOf(value) ?? "").split(/\n|,\s*/);
    return [...new Set(parts.map((p) => (p ?? "").trim()).filter(Boolean))].slice(0, 40);
  }
  if (type === "number") {
    const n = typeof value === "number" ? value : Number(String(textOf(value) ?? "").replace(/[$,\s]/g, ""));
    return value == null || value === "" || !Number.isFinite(n) ? null : n;
  }
  if (type === "date") {
    const s = textOf(value);
    const day = s?.slice(0, 10) ?? null;
    return isDay(day) ? day : null;
  }
  if (type === "time") {
    const m = /^(\d{1,2}):(\d{2})/.exec(textOf(value) ?? "");
    return m && Number(m[1]) < 24 ? `${m[1]!.padStart(2, "0")}:${m[2]}` : null;
  }
  const s = textOf(value);
  return s ? s.slice(0, type === "longtext" ? 20000 : 300) : null;
}

/** An Airtable record's fields → calendar values for every mapped field (missing fields read as empty). */
export function fromAirtableFields(entity: SyncEntity, fields: Record<string, unknown>, map: FieldMap): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of SYNC_FIELDS[entity]) {
    const name = map.fields[field.key];
    if (!name) continue;
    out[field.key] = fromAirtableValue(fields[name], field.type);
  }
  return out;
}

/** The Airtable record's last-modified instant, from the mapped "Last modified time" field. */
export function remoteModifiedAt(fields: Record<string, unknown>, map: FieldMap): Date | null {
  if (!map.modifiedField) return null;
  const raw = fields[map.modifiedField];
  const d = typeof raw === "string" ? new Date(raw) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

function same(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (v == null || v === "" || (Array.isArray(v) && v.length === 0) ? null : Array.isArray(v) ? v.map(String).join("\u0001") : String(v));
  return norm(a) === norm(b);
}

/** Only the values that differ from the local row. */
export function changedValues(remote: Record<string, unknown>, local: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(remote)) if (!same(v, local[k])) out[k] = v;
  return out;
}

export type PullDecision = "create" | "update" | "skip-local-newer" | "skip-trashed" | "skip-same";

/** Sync stamps keep updatedAt exactly (see the server), so no tolerance is needed. */
const SLACK_MS = 0;

/**
 * Conflict rule for one pulled record.
 *
 * - No local row: create it.
 * - Local row in the trash: leave it there (a pull never resurrects a delete).
 * - Nothing differs: skip.
 * - The Airtable record has a "Last modified time" newer than the local
 *   updatedAt: Airtable wins and the local row is updated.
 * - Without a modified time, Airtable wins only when the local row has not
 *   been edited since it was last synced, so a local edit is never lost.
 * - Otherwise Postgres wins; its value goes back to Airtable on the next push.
 */
export function pullDecision(input: {
  local: { updatedAt: Date; airtableSyncedAt: Date | null; deletedAt: Date | null } | null;
  remoteModified: Date | null;
  changes: Record<string, unknown>;
}): PullDecision {
  const { local } = input;
  if (!local) return "create";
  if (local.deletedAt) return "skip-trashed";
  if (Object.keys(input.changes).length === 0) return "skip-same";
  if (input.remoteModified) return input.remoteModified.getTime() > local.updatedAt.getTime() ? "update" : "skip-local-newer";
  const unchangedSinceSync = local.airtableSyncedAt && local.updatedAt.getTime() <= local.airtableSyncedAt.getTime() + SLACK_MS;
  return unchangedSinceSync ? "update" : "skip-local-newer";
}

/** Does a local row need pushing (never synced, or edited since its last sync)? */
export function needsPush(row: { updatedAt: Date; airtableSyncedAt: Date | null }): boolean {
  return !row.airtableSyncedAt || row.updatedAt.getTime() > row.airtableSyncedAt.getTime() + SLACK_MS;
}

/** Airtable ids: base "app…", table "tbl…" or a table name, record "rec…". */
export function isBaseId(value: string): boolean {
  return /^app[A-Za-z0-9]{14}$/.test(value);
}

export function isRecordId(value: unknown): value is string {
  return typeof value === "string" && /^rec[A-Za-z0-9]{14}$/.test(value);
}

export function recordsUrl(baseId: string, table: string, recordId?: string): string {
  return `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}${recordId ? `/${recordId}` : ""}`;
}

export function schemaUrl(baseId: string): string {
  return `https://api.airtable.com/v0/meta/bases/${baseId}/tables`;
}

/** Plain words for an Airtable error status. */
export function explainAirtableError(status: number, message = ""): string {
  if (status === 401) return "Airtable rejected the token. Paste a new personal access token.";
  if (status === 403) return "The token cannot reach that base or table. Give it data.records:read and write (and schema.bases:read) on this base.";
  if (status === 404) return "Airtable could not find that base or table. Check the base id and table name.";
  if (status === 422) return `Airtable refused a value${message ? `: ${message}` : ""}. Check the field mapping.`;
  if (status === 429) return "Airtable is rate limiting us. The next run will retry.";
  return `Airtable returned ${status}${message ? `: ${message}` : ""}.`;
}

function keyFrom(secret: string): Buffer {
  return createHash("sha256").update(`calendar-airtable:${secret}`).digest();
}

/** AES-256-GCM with a key derived from AUTH_SECRET. Output: iv.tag.body (base64url). */
export function sealToken(value: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}

export function openToken(payload: string, secret: string): string {
  const [iv, tag, body] = payload.split(".");
  if (!iv || !tag || !body) throw new Error("Stored token is unreadable.");
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

/** "patABC…xyz" → "pat…xyz" for display. */
export function maskToken(token: string): string {
  return token.length > 10 ? `${token.slice(0, 3)}…${token.slice(-4)}` : "…";
}
