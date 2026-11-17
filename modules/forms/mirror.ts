/**
 * One-way mirror of responses into the author's own Airtable table or Google
 * Sheet. Pure parts: secret encryption, target validation, the row a response
 * becomes, the Google service-account JWT and the retry schedule. The network
 * calls live in apps/web/src/features/forms/mirror.ts.
 *
 * Rules: one-way (no response data is ever read back), opt-in per form,
 * credentials encrypted at rest with a key derived from AUTH_SECRET and never
 * sent back to the browser.
 */
import { createCipheriv, createDecipheriv, createHash, createSign, randomBytes } from "node:crypto";
import { buildExportTable } from "./export";
import type { FieldDef, ResponseRecord } from "./types";

export type MirrorProvider = "airtable" | "google_sheets";
export type AirtableTarget = { baseId: string; table: string };
export type SheetsTarget = { spreadsheetId: string; sheet: string };
export type GoogleCredentials = { client_email: string; private_key: string };

export const MIRROR_PROVIDERS: { value: MirrorProvider; label: string }[] = [
  { value: "airtable", label: "Airtable" },
  { value: "google_sheets", label: "Google Sheets" },
];

// --- Secrets ----------------------------------------------------------------

function key(secret: string): Buffer {
  if (!secret || secret.length < 16) throw new Error("AUTH_SECRET must be set (16+ characters) to store mirror credentials.");
  return createHash("sha256").update(`pubcommand-forms-mirror:${secret}`).digest();
}

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext>, base64url. */
export function encryptSecret(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

/** Null when the ciphertext was tampered with or AUTH_SECRET changed. */
export function decryptSecret(token: string, secret: string): string | null {
  const [version, iv, tag, body] = token.split(".");
  if (version !== "v1" || !iv || !tag || body === undefined) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(secret), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// --- Targets and credentials -------------------------------------------------

export function parseAirtableTarget(input: { baseId: string; table: string }): { ok: true; target: AirtableTarget } | { ok: false; error: string } {
  const baseId = input.baseId.trim();
  const table = input.table.trim();
  if (!/^app[A-Za-z0-9]{14}$/.test(baseId)) return { ok: false, error: "The Airtable base id starts with “app” and is 17 characters (it is in the base's URL)." };
  if (!table || table.length > 100) return { ok: false, error: "Name the Airtable table to write to." };
  return { ok: true, target: { baseId, table } };
}

export function airtableTokenProblem(token: string): string | null {
  return /^pat[A-Za-z0-9]{10,}\.[A-Za-z0-9]{20,}$/.test(token.trim()) ? null : "Paste an Airtable personal access token (it starts with “pat”).";
}

/** Accepts a full Sheets URL or a bare id. */
export function parseSheetsTarget(input: { spreadsheet: string; sheet: string }): { ok: true; target: SheetsTarget } | { ok: false; error: string } {
  const raw = input.spreadsheet.trim();
  const fromUrl = raw.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/)?.[1];
  const spreadsheetId = fromUrl ?? (/^[A-Za-z0-9_-]{20,}$/.test(raw) ? raw : "");
  if (!spreadsheetId) return { ok: false, error: "Paste the Google Sheet's link or id." };
  const sheet = input.sheet.trim() || "Responses";
  if (sheet.length > 100 || /['!]/.test(sheet)) return { ok: false, error: "Use a tab name without quotes or exclamation marks." };
  return { ok: true, target: { spreadsheetId, sheet } };
}

export function parseGoogleCredentials(json: string): { ok: true; credentials: GoogleCredentials } | { ok: false; error: string } {
  try {
    const data = JSON.parse(json) as Record<string, unknown>;
    const email = typeof data.client_email === "string" ? data.client_email : "";
    const privateKey = typeof data.private_key === "string" ? data.private_key : "";
    if (!/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(email) || !privateKey.includes("PRIVATE KEY")) {
      return { ok: false, error: "Paste the service account's JSON key (it has client_email and private_key)." };
    }
    return { ok: true, credentials: { client_email: email, private_key: privateKey } };
  } catch {
    return { ok: false, error: "That is not valid JSON. Paste the whole key file." };
  }
}

/** Shown on the form instead of the secret. */
export function describeTarget(provider: MirrorProvider, target: unknown): string {
  const value = (target ?? {}) as Record<string, string>;
  return provider === "airtable" ? `Airtable · base ${value.baseId ?? "?"} · table “${value.table ?? "?"}”` : `Google Sheets · ${value.spreadsheetId?.slice(0, 10) ?? "?"}… · tab “${value.sheet ?? "?"}”`;
}

// --- What gets written -------------------------------------------------------

/** One response as { column: value }, using the same columns and text as the CSV export. */
export function mirrorRecord(fields: readonly FieldDef[], response: ResponseRecord): { header: string[]; values: string[] } {
  const table = buildExportTable(fields, [response]);
  return { header: table.header, values: table.rows[0] ?? [] };
}

/** Airtable "create records" body. typecast lets Airtable coerce text into its own field types. */
export function airtablePayload(record: { header: string[]; values: string[] }): { records: { fields: Record<string, string> }[]; typecast: true } {
  const fields: Record<string, string> = {};
  record.header.forEach((column, index) => {
    const value = record.values[index] ?? "";
    if (value !== "") fields[column] = value.slice(0, 100000);
  });
  return { records: [{ fields }], typecast: true };
}

/** Columns the Airtable table still needs, by name (case-sensitive like Airtable). */
export function missingColumns(have: readonly string[], want: readonly string[]): string[] {
  const existing = new Set(have);
  return want.filter((column) => !existing.has(column));
}

/**
 * Align a row to the sheet's header. Existing columns keep their place, new
 * question columns are appended to the header, nothing is reordered. A
 * spreadsheet cell starting with = + - @ is prefixed with ' (formula injection).
 */
export function alignToHeader(existing: readonly string[], record: { header: string[]; values: string[] }): { header: string[]; headerChanged: boolean; row: string[] } {
  const header = existing.filter((cell) => cell !== "").length ? [...existing] : [];
  let headerChanged = header.length === 0;
  for (const column of record.header) {
    if (!header.includes(column)) {
      header.push(column);
      headerChanged = true;
    }
  }
  const row = header.map((column) => {
    const index = record.header.indexOf(column);
    const value = index >= 0 ? (record.values[index] ?? "") : "";
    return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  });
  return { header, headerChanged, row };
}

/** A1 column letters for a 1-based count. */
export function a1Column(count: number): string {
  let name = "";
  let n = Math.max(1, count);
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/** A signed RS256 JWT for the OAuth service-account flow. */
export function googleJwt(credentials: GoogleCredentials, now: Date): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const iat = Math.floor(now.getTime() / 1000);
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iss: credentials.client_email, scope: SHEETS_SCOPE, aud: GOOGLE_TOKEN_URL, iat, exp: iat + 3600 })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(credentials.private_key).toString("base64url");
  return `${unsigned}.${signature}`;
}

// --- Retries -------------------------------------------------------------------

export const MIRROR_MAX_ATTEMPTS = 8;

/** Minutes to wait after the Nth failed attempt: 5, 15, 30, 60, 120, 240, 480. */
export function retryDelayMinutes(attempts: number): number {
  return [0, 5, 15, 30, 60, 120, 240, 480][Math.min(attempts, 7)]!;
}

export type MirrorRow = { id: string; mirrorStatus: string | null; mirrorAttempts: number; mirrorTriedAt: Date | null; spamReason: string | null; status: string };

/**
 * Which responses the retry job should (re)send. Pending ones the submit
 * route did not get to (older than 5 minutes), and failed ones whose backoff
 * has passed, up to MIRROR_MAX_ATTEMPTS. Spam and partials are never mirrored.
 */
export function mirrorDue(rows: readonly MirrorRow[], now: Date): string[] {
  return rows
    .filter((row) => row.status === "COMPLETE" && !row.spamReason && row.mirrorAttempts < MIRROR_MAX_ATTEMPTS)
    .filter((row) => {
      if (row.mirrorStatus !== "pending" && row.mirrorStatus !== "failed") return false;
      const last = row.mirrorTriedAt?.getTime() ?? 0;
      const wait = row.mirrorStatus === "pending" && row.mirrorAttempts === 0 ? 5 : retryDelayMinutes(row.mirrorAttempts);
      return now.getTime() - last >= wait * 60 * 1000;
    })
    .map((row) => row.id);
}

/** Error text safe to show on the form: no tokens, trimmed. */
export function safeError(message: string): string {
  return message.replace(/pat[A-Za-z0-9]{10,}\.[A-Za-z0-9]+/g, "pat…").replace(/Bearer\s+\S+/gi, "Bearer …").slice(0, 300);
}
