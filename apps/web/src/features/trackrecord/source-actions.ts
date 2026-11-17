"use server";

import { tenantDb } from "@pubcommand/db";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { encryptSecret, parseAirtableUrl, parseSheetUrl } from "../../../../../modules/performance/sources";
import { trackAccess } from "./context";
import { afterPositionsChanged, auditTrack } from "./server";
import { syncSource } from "./sources";

const UUID = /^[0-9a-f-]{36}$/i;

function text(formData: FormData, key: string, max = 300): string {
  return String(formData.get(key) ?? "").trim().slice(0, max);
}

function go(path: string, message: { error?: string; notice?: string }): never {
  const query = message.error ? `?error=${encodeURIComponent(message.error)}` : message.notice ? `?notice=${encodeURIComponent(message.notice)}` : "";
  redirect(`${path}${query}`);
}

async function writer() {
  const access = await trackAccess("performance.write");
  if (!access.ok) go("/performance/import", { error: access.error });
  return access.scope;
}

function seal(value: string): string | null {
  const secret = process.env.AUTH_SECRET ?? "";
  return value ? encryptSecret(value, secret) : null;
}

/** Connect a Google Sheet or an Airtable table. The person's token is encrypted with AUTH_SECRET and never shown again. */
export async function createSource(formData: FormData) {
  const scope = await writer();
  const kind = text(formData, "kind", 10) === "AIRTABLE" ? "AIRTABLE" : "GSHEET";
  const url = text(formData, "url", 500);
  const tokenValue = text(formData, "token", 500);
  const name = text(formData, "name", 120);
  const base = { organizationId: scope.organizationId, brandId: scope.brandId, kind, defaultPortfolio: text(formData, "defaultPortfolio", 120), autoSync: formData.get("autoSync") === "on", createdById: scope.actorId };
  let data;
  if (kind === "GSHEET") {
    const sheet = parseSheetUrl(url);
    if (!sheet) go("/performance/import", { error: "Paste the Google Sheet's link (docs.google.com/spreadsheets/d/…)." });
    const range = text(formData, "range", 120);
    if (tokenValue && !range) go("/performance/import", { error: "With a Google API key, also give the tab name or range, e.g. Closed!A:Z." });
    data = { ...base, name: name || "Google Sheet", sheetId: sheet.sheetId, sheetGid: sheet.gid, sheetRange: range || null, tokenEnc: seal(tokenValue) };
  } else {
    const table = parseAirtableUrl(url);
    const tableName = text(formData, "table", 120) || table?.tableId || "";
    if (!table || !tableName) go("/performance/import", { error: "Paste the Airtable link to the table (airtable.com/app…/tbl…), or the base link and the table name." });
    if (!tokenValue) go("/performance/import", { error: "Airtable needs your personal access token with read access to this base." });
    data = { ...base, name: name || "Airtable", airtableBase: table.baseId, airtableTable: tableName, airtableView: table.viewId, tokenEnc: seal(tokenValue) };
  }
  let created;
  try {
    created = await tenantDb(scope.organizationId).trackImportSource.create({ data });
  } catch (error) {
    go("/performance/import", { error: error instanceof Error && /AUTH_SECRET/.test(error.message) ? "AUTH_SECRET is not set, so the token cannot be stored safely." : "The source could not be saved." });
  }
  await auditTrack(scope, "trackrecord.source.created", "track_import_source", created.id, { kind });
  go(`/performance/import/sources/${created.id}`, { notice: "Connected. Check the dry run below, then sync." });
}

async function sourceFrom(formData: FormData) {
  const scope = await writer();
  const id = text(formData, "sourceId", 40);
  const source = UUID.test(id) ? await tenantDb(scope.organizationId).trackImportSource.findFirst({ where: { id, brandId: scope.brandId, deletedAt: null } }) : null;
  if (!source) go("/performance/import", { error: "That source no longer exists." });
  return { scope, source };
}

export async function syncSourceNow(formData: FormData) {
  const { scope, source } = await sourceFrom(formData);
  const outcome = await syncSource(scope, source, { apply: true });
  if (!outcome.ok) go(`/performance/import/sources/${source.id}`, { error: outcome.error });
  if (outcome.applied) after(() => afterPositionsChanged(scope, outcome.applied!.portfolioIds, outcome.applied!.positionIds.slice(0, 200)));
  go(`/performance/import/sources/${source.id}`, {
    notice: `Synced: ${outcome.applied?.created ?? 0} new, ${outcome.applied?.closed ?? 0} closed, ${outcome.plan.counts.skip} already recorded, ${outcome.plan.counts.error} with errors.`,
  });
}

export async function updateSource(formData: FormData) {
  const { scope, source } = await sourceFrom(formData);
  const tokenValue = text(formData, "token", 500);
  const data: Record<string, unknown> = {
    name: text(formData, "name", 120) || source.name,
    defaultPortfolio: text(formData, "defaultPortfolio", 120),
    autoSync: formData.get("autoSync") === "on",
  };
  if (source.kind === "GSHEET") data.sheetRange = text(formData, "range", 120) || null;
  if (tokenValue) data.tokenEnc = seal(tokenValue);
  if (formData.get("clearToken") === "on" && source.kind === "GSHEET") data.tokenEnc = null;
  await tenantDb(scope.organizationId).trackImportSource.updateMany({ where: { id: source.id }, data });
  await auditTrack(scope, "trackrecord.source.updated", "track_import_source", source.id, { tokenChanged: Boolean(tokenValue) });
  go(`/performance/import/sources/${source.id}`, { notice: "Saved." });
}

export async function deleteSource(formData: FormData) {
  const { scope, source } = await sourceFrom(formData);
  await tenantDb(scope.organizationId).trackImportSource.updateMany({ where: { id: source.id }, data: { deletedAt: new Date(), tokenEnc: null, autoSync: false } });
  await auditTrack(scope, "trackrecord.source.deleted", "track_import_source", source.id);
  go("/performance/import", { notice: "Source removed. Recommendations it imported are kept." });
}
