/**
 * Google Sheets sync helpers: reading the sheet address, the service-account
 * key (validated, then encrypted with AUTH_SECRET), the signed token request,
 * and turning the API's values into a table. No network here.
 */

import { createCipheriv, createDecipheriv, createHash, createSign, randomBytes } from "node:crypto";

export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const SYNC_INTERVALS = [1, 6, 24] as const;

/** Accepts a full Google Sheets link or the bare id. */
export function parseSpreadsheetId(input: string): string | null {
  const value = input.trim();
  const fromUrl = /docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/.exec(value);
  if (fromUrl) return fromUrl[1]!;
  return /^[a-zA-Z0-9_-]{20,100}$/.test(value) ? value : null;
}

/** A tab name or A1 range. Keeps it short and free of characters the API rejects. */
export function cleanRange(input: string): string {
  const value = input.trim().slice(0, 120);
  return value && !/[\u0000-\u001f]/.test(value) ? value : "Sheet1";
}

export function valuesUrl(spreadsheetId: string, range: string): string {
  return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`;
}

export type ServiceAccount = { clientEmail: string; privateKey: string; tokenUri: string };

/** Read a pasted service-account JSON key. Returns a readable problem instead of throwing. */
export function parseServiceAccount(raw: string): ServiceAccount | { error: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { error: "That is not valid JSON. Paste the whole key file you downloaded from Google Cloud." };
  }
  const key = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  if (key.type !== "service_account") return { error: "That key is not a service-account key (its type must be service_account)." };
  const clientEmail = typeof key.client_email === "string" ? key.client_email.trim() : "";
  const privateKey = typeof key.private_key === "string" ? key.private_key : "";
  if (!/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(clientEmail)) return { error: "The key has no service-account email." };
  if (!privateKey.includes("BEGIN PRIVATE KEY")) return { error: "The key has no private key in it." };
  // Only Google's own token endpoint is ever called, whatever the file says.
  return { clientEmail, privateKey, tokenUri: TOKEN_URL };
}

const b64url = (value: Buffer | string) => Buffer.from(value).toString("base64url");

/** The signed JWT a service account trades for an access token (RS256). */
export function signedAssertion(account: ServiceAccount, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: account.clientEmail, scope: SHEETS_SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${b64url(signer.sign(account.privateKey))}`;
}

// ── Secret storage (AES-256-GCM, key derived from AUTH_SECRET) ─────────────

function secretKey(authSecret: string): Buffer {
  if (!authSecret || authSecret.length < 16) throw new Error("AUTH_SECRET is not set, so the key cannot be stored safely.");
  return createHash("sha256").update(`promo-sheets-credentials:${authSecret}`).digest();
}

export function encryptSecret(value: string, authSecret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(authSecret), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1.${b64url(iv)}.${b64url(cipher.getAuthTag())}.${b64url(body)}`;
}

/** Null when the value was encrypted with another AUTH_SECRET or is damaged. */
export function decryptSecret(payload: string, authSecret: string): string | null {
  const [version, iv, tag, body] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !body) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", secretKey(authSecret), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// ── Values → table ───────────────────────────────────────────────────────────

/** The API drops trailing empty cells; pad every row to the header width and drop blank rows. */
export function valuesToTable(values: unknown): string[][] {
  if (!Array.isArray(values)) return [];
  const rows = values.map((row) => (Array.isArray(row) ? row.map((cell) => (cell == null ? "" : String(cell).trim())) : []));
  const width = Math.max(0, ...rows.map((row) => row.length));
  return rows.map((row) => [...row, ...Array(width - row.length).fill("")]).filter((row) => row.some((cell) => cell !== ""));
}

export function tableHash(table: readonly (readonly string[])[]): string {
  return createHash("sha256").update(JSON.stringify(table)).digest("hex");
}

/** Due when enabled and never synced, or the interval has passed. */
export function syncDue(input: { enabled: boolean; everyHours: number; lastSyncAt: Date | null; status: string; updatedAt: Date }, now: Date): boolean {
  if (!input.enabled) return false;
  // A RUNNING sync younger than 30 minutes is still going.
  if (input.status === "RUNNING" && now.getTime() - input.updatedAt.getTime() < 30 * 60_000) return false;
  if (!input.lastSyncAt) return true;
  return now.getTime() - input.lastSyncAt.getTime() >= Math.max(1, input.everyHours) * 3600_000 - 60_000;
}

/** Google's error bodies, turned into the step a person must take. */
export function explainSheetsError(status: number, message: string): string {
  if (status === 403) return "Google refused access. Share the sheet with the service-account email (Viewer), and turn on the Google Sheets API in that Google Cloud project.";
  if (status === 404) return "Google could not find that sheet. Check the link or id.";
  if (status === 400 && /range/i.test(message)) return "That tab or range does not exist in the sheet.";
  if (status === 401) return "Google rejected the key. Create a new key for the service account and save it again.";
  return `Google Sheets answered ${status}${message ? `: ${message.slice(0, 200)}` : ""}.`;
}
