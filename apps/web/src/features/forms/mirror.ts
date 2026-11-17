import { tenantDb } from "@pubcommand/db";
import {
  GOOGLE_TOKEN_URL,
  a1Column,
  airtablePayload,
  alignToHeader,
  decryptSecret,
  googleJwt,
  missingColumns,
  mirrorRecord,
  safeError,
  type AirtableTarget,
  type GoogleCredentials,
  type MirrorProvider,
  type SheetsTarget,
} from "../../../../../modules/forms/mirror";
import { rowToField, toResponseRecord } from "./data";

/**
 * One-way copy of a response into the author's Airtable table or Google
 * Sheet. Only column NAMES are read from the destination (to add missing
 * ones); no response data is ever read back.
 */

type Fetch = typeof fetch;
const TIMEOUT_MS = 15000;

async function call(fetchImpl: Fetch, url: string, init: RequestInit): Promise<Response> {
  const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) {
    const body = (await response.text().catch(() => "")).slice(0, 200);
    throw new Error(`${new URL(url).host} answered ${response.status}${body ? `: ${body}` : ""}`);
  }
  return response;
}

async function airtableWrite(fetchImpl: Fetch, token: string, target: AirtableTarget, record: { header: string[]; values: string[] }) {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const base = `https://api.airtable.com/v0/meta/bases/${encodeURIComponent(target.baseId)}/tables`;
  // Make sure the table and its columns exist (all as long text). Needs schema.bases:read/write on the token.
  const tables = (await (await call(fetchImpl, base, { headers })).json()) as { tables?: { id: string; name: string; fields: { name: string }[] }[] };
  const table = tables.tables?.find((item) => item.name === target.table);
  if (!table) {
    await call(fetchImpl, base, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: target.table, fields: record.header.map((name) => ({ name, type: name === "Response ID" ? "singleLineText" : "multilineText" })) }),
    });
  } else {
    for (const name of missingColumns(table.fields.map((field) => field.name), record.header)) {
      await call(fetchImpl, `${base}/${table.id}/fields`, { method: "POST", headers, body: JSON.stringify({ name, type: "multilineText" }) });
    }
  }
  await call(fetchImpl, `https://api.airtable.com/v0/${encodeURIComponent(target.baseId)}/${encodeURIComponent(target.table)}`, {
    method: "POST",
    headers,
    body: JSON.stringify(airtablePayload(record)),
  });
}

async function googleToken(fetchImpl: Fetch, credentials: GoogleCredentials): Promise<string> {
  const response = await call(fetchImpl, GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: googleJwt(credentials, new Date()) }).toString(),
  });
  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Google did not return an access token.");
  return data.access_token;
}

async function sheetsWrite(fetchImpl: Fetch, credentials: GoogleCredentials, target: SheetsTarget, record: { header: string[]; values: string[] }) {
  const token = await googleToken(fetchImpl, credentials);
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const root = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(target.spreadsheetId)}`;
  const tab = `'${target.sheet}'`;
  const meta = (await (await call(fetchImpl, `${root}?fields=sheets.properties.title`, { headers })).json()) as { sheets?: { properties: { title: string } }[] };
  if (!meta.sheets?.some((sheet) => sheet.properties.title === target.sheet)) {
    await call(fetchImpl, `${root}:batchUpdate`, { method: "POST", headers, body: JSON.stringify({ requests: [{ addSheet: { properties: { title: target.sheet } } }] }) });
  }
  // Header row only: the column names, never any response data.
  const headerRow = (await (await call(fetchImpl, `${root}/values/${encodeURIComponent(`${tab}!1:1`)}`, { headers })).json()) as { values?: string[][] };
  const aligned = alignToHeader(headerRow.values?.[0] ?? [], record);
  if (aligned.headerChanged) {
    await call(fetchImpl, `${root}/values/${encodeURIComponent(`${tab}!A1:${a1Column(aligned.header.length)}1`)}?valueInputOption=RAW`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ values: [aligned.header] }),
    });
  }
  await call(fetchImpl, `${root}/values/${encodeURIComponent(`${tab}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    headers,
    body: JSON.stringify({ values: [aligned.row] }),
  });
}

/** Send one response to the form's mirror and record the outcome on the response and the mirror. */
export async function mirrorResponse(organizationId: string, responseId: string, fetchImpl: Fetch = fetch): Promise<"ok" | "failed" | "skipped"> {
  const db = tenantDb(organizationId);
  const row = await db.formResponse.findFirst({ where: { id: responseId } });
  if (!row || row.status !== "COMPLETE" || row.spamReason || row.mirrorStatus === "ok") return "skipped";
  const mirror = await db.formMirror.findFirst({ where: { formId: row.formId } });
  if (!mirror?.enabled) {
    await db.formResponse.updateMany({ where: { id: responseId, mirrorStatus: { not: "ok" } }, data: { mirrorStatus: null } });
    return "skipped";
  }
  const now = new Date();
  try {
    const secret = decryptSecret(mirror.secretCipher, process.env.AUTH_SECRET ?? "");
    if (!secret) throw new Error("The saved credentials can no longer be read (AUTH_SECRET changed). Enter them again.");
    const fields = (await db.formField.findMany({ where: { formId: row.formId }, orderBy: { position: "asc" } })).map(rowToField);
    const record = mirrorRecord(fields, toResponseRecord(row));
    const provider = mirror.provider as MirrorProvider;
    if (provider === "airtable") await airtableWrite(fetchImpl, secret, mirror.target as unknown as AirtableTarget, record);
    else await sheetsWrite(fetchImpl, JSON.parse(secret) as GoogleCredentials, mirror.target as unknown as SheetsTarget, record);
    await db.formResponse.updateMany({ where: { id: responseId }, data: { mirrorStatus: "ok", mirrorError: null, mirrorTriedAt: now, mirrorAttempts: { increment: 1 } } });
    await db.formMirror.updateMany({ where: { id: mirror.id }, data: { lastError: null, lastSyncedAt: now } });
    return "ok";
  } catch (error) {
    const message = safeError(error instanceof Error ? error.message : "The copy failed.");
    await db.formResponse.updateMany({ where: { id: responseId }, data: { mirrorStatus: "failed", mirrorError: message, mirrorTriedAt: now, mirrorAttempts: { increment: 1 } } });
    await db.formMirror.updateMany({ where: { id: mirror.id }, data: { lastError: message } });
    return "failed";
  }
}
