import { tenantDb } from "@pubcommand/db";
import { mappingFromHeaders, parseHeaderMapping, toCsv } from "../../../../../modules/promo-studio/imports";
import {
  TOKEN_URL,
  decryptSecret,
  explainSheetsError,
  parseServiceAccount,
  signedAssertion,
  tableHash,
  valuesToTable,
  valuesUrl,
  type ServiceAccount,
} from "../../../../../modules/promo-studio/sheets";
import { runPerformanceImport } from "./insights";

type Fetch = typeof fetch;

export class SheetError extends Error {}

function authSecret(): string {
  const secret = process.env.AUTH_SECRET ?? "";
  if (secret.length < 16) throw new SheetError("AUTH_SECRET is not set on the server, so saved keys cannot be read.");
  return secret;
}

/** Trade the service-account key for a short-lived, read-only access token. */
async function accessToken(account: ServiceAccount, fetcher: Fetch): Promise<string> {
  const response = await fetcher(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: signedAssertion(account) }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await response.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!response.ok || !body.access_token) throw new SheetError(explainSheetsError(response.status === 400 ? 401 : response.status, body.error_description ?? ""));
  return body.access_token;
}

/** Read one range of a sheet as a table (header row first). */
export async function fetchSheet(input: { account: ServiceAccount; spreadsheetId: string; range: string; fetcher?: Fetch }): Promise<string[][]> {
  const fetcher = input.fetcher ?? fetch;
  const token = await accessToken(input.account, fetcher);
  const response = await fetcher(valuesUrl(input.spreadsheetId, input.range), { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  const body = (await response.json().catch(() => ({}))) as { values?: unknown; error?: { message?: string } };
  if (!response.ok) throw new SheetError(explainSheetsError(response.status, body.error?.message ?? ""));
  const table = valuesToTable(body.values);
  if (table.length < 2) throw new SheetError("The sheet needs a header row and at least one row of results.");
  return table;
}

export function accountFrom(credentials: string | null): ServiceAccount {
  if (!credentials) throw new SheetError("Save a service-account key first.");
  const json = decryptSecret(credentials, authSecret());
  if (!json) throw new SheetError("The saved key cannot be read (AUTH_SECRET changed). Paste the key again.");
  const account = parseServiceAccount(json);
  if ("error" in account) throw new SheetError(account.error);
  return account;
}

export async function loadSheetSync(organizationId: string, brandId: string) {
  return tenantDb(organizationId).promoSheetSync.findFirst({ where: { brandId } });
}

/**
 * Sync one brand's sheet: read it, skip it when nothing changed since the last
 * sync, otherwise store it as an import (so it can be undone like an upload)
 * and run the same import as a file.
 */
export async function runSheetSync(input: { organizationId: string; brandId: string; actorId: string | null; force?: boolean; fetcher?: Fetch }): Promise<{ status: "imported" | "unchanged" | "failed"; importId?: string; error?: string }> {
  const db = tenantDb(input.organizationId);
  const config = await db.promoSheetSync.findFirst({ where: { brandId: input.brandId } });
  if (!config) return { status: "failed", error: "No sheet is set up." };
  await db.promoSheetSync.updateMany({ where: { id: config.id }, data: { status: "RUNNING", lastError: null } });
  try {
    const table = await fetchSheet({ account: accountFrom(config.credentials), spreadsheetId: config.spreadsheetId, range: config.range, fetcher: input.fetcher });
    const headers = (table[0] ?? []).map((h, i) => (h || `Column ${i + 1}`).slice(0, 120));
    const mapping = mappingFromHeaders(parseHeaderMapping(config.mapping), headers);
    if (mapping.code < 0) throw new SheetError("The promo code column is not in the sheet any more. Map the columns again.");
    if (mapping.orders < 0 && mapping.revenue < 0) throw new SheetError("Neither the orders nor the revenue column is in the sheet any more. Map the columns again.");
    const hash = tableHash(table);
    if (!input.force && hash === config.lastHash) {
      await db.promoSheetSync.updateMany({ where: { id: config.id }, data: { status: "OK", lastSyncAt: new Date(), headers } });
      return { status: "unchanged" };
    }
    const csv = Buffer.from(toCsv(table), "utf8");
    const upload = await db.promoPerformanceImport.create({
      data: {
        organizationId: input.organizationId,
        brandId: input.brandId,
        filename: `Google Sheet ${config.range}.csv`.slice(0, 200),
        mimeType: "text/csv",
        size: csv.length,
        data: new Uint8Array(csv),
        status: "IMPORTING",
        source: "sheet",
        contentHash: hash,
        headers,
        createdById: input.actorId,
      },
    });
    await runPerformanceImport({ organizationId: input.organizationId, brandId: input.brandId, importId: upload.id, mapping });
    const done = await db.promoPerformanceImport.findFirst({ where: { id: upload.id }, select: { status: true, error: true } });
    if (done?.status !== "DONE") throw new SheetError(done?.error ?? "The import failed.");
    await db.promoSheetSync.updateMany({ where: { id: config.id }, data: { status: "OK", lastError: null, lastSyncAt: new Date(), lastHash: hash, lastImportId: upload.id, headers } });
    return { status: "imported", importId: upload.id };
  } catch (error) {
    const reason = error instanceof SheetError ? error.message : error instanceof Error ? `The sync failed: ${error.message}` : "The sync failed.";
    await db.promoSheetSync.updateMany({ where: { id: config.id }, data: { status: "FAILED", lastError: reason.slice(0, 1000), lastSyncAt: new Date() } }).catch(() => undefined);
    return { status: "failed", error: reason };
  }
}

/** Read just the header row, to map columns when a sheet is first connected. */
export async function previewSheetHeaders(input: { organizationId: string; brandId: string; fetcher?: Fetch }): Promise<{ headers: string[]; sample: string[][] } | { error: string }> {
  const config = await loadSheetSync(input.organizationId, input.brandId);
  if (!config) return { error: "Save the sheet first." };
  try {
    const table = await fetchSheet({ account: accountFrom(config.credentials), spreadsheetId: config.spreadsheetId, range: config.range, fetcher: input.fetcher });
    const headers = (table[0] ?? []).map((h, i) => (h || `Column ${i + 1}`).slice(0, 120));
    await tenantDb(input.organizationId).promoSheetSync.updateMany({ where: { id: config.id }, data: { headers, lastError: null, status: config.status === "FAILED" ? "IDLE" : config.status } });
    return { headers, sample: table.slice(0, 6) };
  } catch (error) {
    const reason = error instanceof SheetError ? error.message : "The sheet could not be read.";
    await tenantDb(input.organizationId).promoSheetSync.updateMany({ where: { id: config.id }, data: { lastError: reason } });
    return { error: reason };
  }
}
