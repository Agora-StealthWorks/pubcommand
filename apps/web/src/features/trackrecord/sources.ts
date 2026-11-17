import { tenantDb } from "@pubcommand/db";
import type { ImportPlan } from "../../../../../modules/performance/positions";
import { airtableListUrl, airtableTable, decryptSecret, sheetCsvUrl, sheetValuesTable, sheetValuesUrl } from "../../../../../modules/performance/sources";
import { parseCsv } from "../../../../../modules/performance/positions";
import { applyImportPlan, planTable, type ApplyResult } from "./importer";
import type { TrackWorkScope } from "./server";

type Db = ReturnType<typeof tenantDb>;
export type SourceRow = Awaited<ReturnType<Db["trackImportSource"]["findMany"]>>[number];

const TIMEOUT_MS = 20_000;
const MAX_AIRTABLE_PAGES = 20;

function authSecret(): string {
  return process.env.AUTH_SECRET ?? "";
}

function token(source: SourceRow): string | null {
  if (!source.tokenEnc) return null;
  try {
    return decryptSecret(source.tokenEnc, authSecret());
  } catch {
    return null;
  }
}

export type TableResult = { ok: true; table: string[][] } | { ok: false; error: string };

/** Read a source into a header row + data rows. Never throws. */
export async function fetchSourceTable(source: SourceRow, fetchImpl: typeof fetch = fetch): Promise<TableResult> {
  try {
    if (source.kind === "GSHEET") {
      if (!source.sheetId) return { ok: false, error: "This source has no sheet." };
      const key = token(source);
      if (source.tokenEnc && !key) return { ok: false, error: "The stored Google key could not be read. Enter it again." };
      if (key) {
        const response = await fetchImpl(sheetValuesUrl(source.sheetId, source.sheetRange || "A:Z", key), { signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!response.ok) return { ok: false, error: response.status === 403 ? "Google refused the key, or the key cannot see this sheet." : `Google Sheets returned ${response.status}.` };
        const body = (await response.json()) as { values?: unknown };
        return { ok: true, table: sheetValuesTable(body.values) };
      }
      const response = await fetchImpl(sheetCsvUrl(source.sheetId, source.sheetGid), { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "follow" });
      const type = response.headers.get("content-type") ?? "";
      if (!response.ok || type.includes("text/html")) {
        return { ok: false, error: "The sheet could not be read. Share it as \"Anyone with the link can view\", or add a Google API key and the tab name." };
      }
      return { ok: true, table: parseCsv((await response.text()).slice(0, 5_000_000)) };
    }
    if (source.kind === "AIRTABLE") {
      if (!source.airtableBase || !source.airtableTable) return { ok: false, error: "This source needs a base and a table." };
      const key = token(source);
      if (!key) return { ok: false, error: "Add your Airtable personal access token (read access to this base)." };
      const records: { fields?: Record<string, unknown> }[] = [];
      let offset: string | null = null;
      for (let page = 0; page < MAX_AIRTABLE_PAGES; page += 1) {
        const response = await fetchImpl(airtableListUrl({ baseId: source.airtableBase, table: source.airtableTable, view: source.airtableView, offset }), {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) return { ok: false, error: response.status === 401 || response.status === 403 ? "Airtable refused the token, or it cannot read this base." : `Airtable returned ${response.status}.` };
        const body = (await response.json()) as { records?: { fields?: Record<string, unknown> }[]; offset?: string };
        records.push(...(body.records ?? []));
        offset = body.offset ?? null;
        if (!offset) break;
      }
      return { ok: true, table: airtableTable(records) };
    }
    return { ok: false, error: "Unknown source type." };
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return { ok: false, error: timeout ? "The source took too long to answer." : "The source could not be reached." };
  }
}

export type SyncOutcome = { ok: true; plan: ImportPlan; applied: ApplyResult | null } | { ok: false; error: string };

/** Dry run (apply = false) or sync (apply = true). Records the outcome on the source either way when applying. */
export async function syncSource(scope: TrackWorkScope, source: SourceRow, options: { apply: boolean }): Promise<SyncOutcome> {
  const db = tenantDb(scope.organizationId);
  const fetched = await fetchSourceTable(source);
  if (!fetched.ok) {
    if (options.apply) await db.trackImportSource.updateMany({ where: { id: source.id }, data: { lastSyncAt: new Date(), lastStatus: "failed", lastMessage: fetched.error } });
    return fetched;
  }
  if (fetched.table.length < 2) {
    const error = "The source has no rows under its header.";
    if (options.apply) await db.trackImportSource.updateMany({ where: { id: source.id }, data: { lastSyncAt: new Date(), lastStatus: "failed", lastMessage: error } });
    return { ok: false, error };
  }
  const plan = await planTable(scope, fetched.table, source.defaultPortfolio);
  if (!options.apply) return { ok: true, plan, applied: null };
  const applied = plan.counts.create + plan.counts.close > 0 ? await applyImportPlan(scope, plan, `source:${source.id}`) : null;
  const message = `${applied?.created ?? 0} new, ${applied?.closed ?? 0} closed, ${plan.counts.skip} already recorded, ${plan.counts.error} with errors${applied?.problems.length ? `, ${applied.problems.length} close(s) not applied` : ""}.`;
  await db.trackImportSource.updateMany({ where: { id: source.id }, data: { lastSyncAt: new Date(), lastStatus: "ok", lastMessage: message } });
  return { ok: true, plan, applied };
}
