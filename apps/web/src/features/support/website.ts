import { tenantDb } from "@pubcommand/db";
import { contentHash } from "../../../../../modules/support/render";
import { csvToPages, pageBody, preparePage, sheetCsvUrl, type SitePageInput } from "../../../../../modules/support/site-pages";
import { saveRecord } from "./records";

/**
 * Website directory import (sheet, CSV upload, WordPress-style ingest). Rows are keyed by
 * normalized URL (sourceRef "site:<url>"). A page edited here is locked and skipped.
 * Access level fails safe (unclear → members only), and the gate hides internal content.
 */

export type ImportResult = {
  rows: number;
  created: number;
  updated: number;
  unchanged: number;
  locked: number;
  invalid: { row: number; reason: string }[];
  byAudience: { public: number; member: number };
  hidden: number;
  review: { title: string; url: string; notes: string[] }[];
};

export const MAX_IMPORT_ROWS = 5_000;

export async function importPages(
  scope: { organizationId: string; brandId: string; actorId: string | null },
  input: SitePageInput[],
  options: { dryRun?: boolean } = {},
): Promise<ImportResult> {
  const db = tenantDb(scope.organizationId);
  const pubs = await db.calendarPublication.findMany({ where: { brandId: scope.brandId }, select: { code: true, name: true } });
  const result: ImportResult = { rows: input.length, created: 0, updated: 0, unchanged: 0, locked: 0, invalid: [], byAudience: { public: 0, member: 0 }, hidden: 0, review: [] };
  const prepared = new Map<string, Exclude<ReturnType<typeof preparePage>, { error: string }>>();
  input.slice(0, MAX_IMPORT_ROWS).forEach((row, index) => {
    const page = preparePage(row, pubs);
    if ("error" in page) result.invalid.push({ row: index + 2, reason: page.error });
    else prepared.set(page.url, page);
  });
  if (input.length > MAX_IMPORT_ROWS) result.invalid.push({ row: MAX_IMPORT_ROWS + 2, reason: `only the first ${MAX_IMPORT_ROWS} rows are imported` });

  const refs = [...prepared.keys()].map((url) => `site:${url}`);
  const existing = new Map<string, { id: string; locked: boolean; sourceHash: string | null }>();
  for (let i = 0; i < refs.length; i += 500) {
    const rows = await db.supportRecord.findMany({ where: { brandId: scope.brandId, sourceRef: { in: refs.slice(i, i + 500) } }, select: { id: true, locked: true, sourceHash: true, sourceRef: true } });
    for (const row of rows) existing.set(row.sourceRef ?? "", row);
  }

  for (const page of prepared.values()) {
    const ref = `site:${page.url}`;
    const old = existing.get(ref);
    if (old?.locked) {
      result.locked += 1;
      continue;
    }
    result.byAudience[page.audience] += 1;
    if (page.status !== "published") result.hidden += 1;
    if (page.notes.length && result.review.length < 50) result.review.push({ title: page.title, url: page.url, notes: page.notes });
    const hash = contentHash(JSON.stringify(page));
    if (old && old.sourceHash === hash) {
      result.unchanged += 1;
      continue;
    }
    if (options.dryRun) {
      if (old) result.updated += 1;
      else result.created += 1;
      continue;
    }
    const saved = await saveRecord(
      { ...scope, canPublish: true },
      old?.id ?? null,
      {
        category: "website",
        audience: page.audience,
        status: page.status,
        title: page.title,
        body: pageBody(page),
        summary: page.summary,
        url: page.url,
        tags: page.topics.slice(0, 30),
        publicationCodes: page.publicationCodes,
        gateOverrides: ["competitor"],
      },
      {
        source: "website",
        sourceRef: ref,
        sourceHash: hash,
        lock: false,
        note: "website import",
        meta: { publishedAt: page.publishedAt, author: page.author, product: page.product, accessLevel: page.accessLevel, siteStatus: page.siteStatus, notes: page.notes },
      },
    );
    if (!saved.ok) result.invalid.push({ row: 0, reason: `${page.url}: ${saved.error}` });
    else if (old) result.updated += 1;
    else result.created += 1;
  }
  return result;
}

/** Fetch a link-viewable sheet (or any https CSV) and import it. */
export async function importSheet(scope: { organizationId: string; brandId: string; actorId: string | null }, sheetUrl: string, fetchImpl: typeof fetch = fetch): Promise<ImportResult | { error: string }> {
  const url = sheetCsvUrl(sheetUrl);
  if (!url) return { error: "Paste a Google Sheets link (docs.google.com/spreadsheets/…). For other sources, upload a CSV." };
  let text: string;
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(30_000), redirect: "follow" });
    if (!response.ok) return { error: `The sheet could not be read (HTTP ${response.status}). Share it as "anyone with the link can view".` };
    text = await response.text();
  } catch {
    return { error: "The sheet could not be reached." };
  }
  if (text.length > 20_000_000) return { error: "The sheet is too large (20 MB max)." };
  if (/^\s*<!doctype html|^\s*<html/i.test(text)) return { error: "That link returned a web page, not CSV. Share the sheet as viewable by anyone with the link." };
  const { rows } = csvToPages(text);
  return importPages(scope, rows);
}
