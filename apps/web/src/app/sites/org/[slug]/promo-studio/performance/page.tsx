import { tenantDb } from "@pubcommand/db";
import { Button } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { TableScroll } from "@/components/table-scroll";
import { AutoRefresh } from "@/features/promos/auto-refresh";
import { promoPage } from "@/features/promos/guard";
import { listPerformance } from "@/features/promos/insights";
import {
  confirmPerformanceImport,
  discardPerformanceImport,
  disconnectSheet,
  linkPerformance,
  overrideTier,
  rematchPerformance,
  saveSheetMapping,
  saveSheetSync,
  syncSheetNow,
  teachPerformanceBrain,
  undoPerformanceImport,
  uploadPerformanceSheet,
} from "@/features/promos/insights-actions";
import { loadSheetSync } from "@/features/promos/sheets";
import { TIER_KEYS, mappingFromHeaders, parseHeaderMapping } from "../../../../../../../../../modules/promo-studio/imports";
import { SYNC_INTERVALS } from "../../../../../../../../../modules/promo-studio/sheets";
import { InsightsNav, TierBadge, fmtMoney, fmtNumber, fmtPercent } from "@/features/promos/insights-view";
import {
  FIVE_TIER_MIN,
  PERFORMANCE_FIELDS,
  THREE_TIER_MIN,
  TIER_LABELS,
  describeTier,
  enrich,
  guessMapping,
  parseSheet,
  type ColumnMapping,
} from "../../../../../../../../../modules/promo-studio/performance";

export default async function PerformancePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ import?: string; error?: string; notice?: string; sheet?: string; show?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await promoPage(slug);
  if ("denied" in access) return access.denied === "notfound" ? notFound() : <Denied title={access.denied} />;
  const { ctx, writable } = access;
  const db = tenantDb(ctx.resolved.id);
  const [allRecords, upload, imports, promoTitles, sheet] = await Promise.all([
    listPerformance(ctx.resolved.id, ctx.brand.id),
    query.import && /^[0-9a-f-]{36}$/i.test(query.import) ? db.promoPerformanceImport.findFirst({ where: { id: query.import, brandId: ctx.brand.id } }) : null,
    db.promoPerformanceImport.findMany({
      where: { brandId: ctx.brand.id },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, filename: true, status: true, source: true, codeCount: true, matchedCount: true, createdAt: true, undoneAt: true, createdCodes: true },
    }),
    db.promo.findMany({ where: { brandId: ctx.brand.id, deletedAt: null }, select: { id: true, title: true, promoCode: true }, orderBy: { title: "asc" } }),
    loadSheetSync(ctx.resolved.id, ctx.brand.id),
  ]);
  const titles = new Map(promoTitles.map((p) => [p.id, p.title]));
  const unmatchedCount = allRecords.filter((r) => !r.promoId).length;
  const showUnmatched = query.show === "unmatched";
  const records = showUnmatched ? allRecords.filter((r) => !r.promoId) : allRecords;
  const sheetMapping = sheet?.headers.length ? mappingFromHeaders(parseHeaderMapping(sheet.mapping), sheet.headers) : null;
  const sheetGuess = sheet?.headers.length ? (sheetMapping && sheetMapping.code >= 0 ? sheetMapping : guessMapping(sheet.headers)) : null;
  const sheetBusy = sheet?.status === "RUNNING" && Date.now() - sheet.updatedAt.getTime() < 30 * 60_000;

  let preview: string[][] = [];
  let guessed: ColumnMapping | null = null;
  if (upload && (upload.status === "MAPPING" || upload.status === "FAILED")) {
    try {
      preview = parseSheet(upload.filename, new Uint8Array(upload.data)).slice(0, 6);
    } catch {
      preview = [upload.headers];
    }
    guessed = (upload.mapping as ColumnMapping | null) ?? guessMapping(upload.headers);
  }

  const cohorts = new Map<string, { n: number; scheme: string | null; metric: string | null }>();
  for (const row of records) {
    if (!row.cohort || !row.metric) continue;
    cohorts.set(`${row.cohort} · ${row.metric}`, { n: row.cohortSize ?? 0, scheme: row.tierScheme, metric: row.metric });
  }
  const matched = allRecords.filter((r) => r.promoId).length;

  return (
    <div className="space-y-5">
      <InsightsNav active="performance" />
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Performance</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Import real results for {ctx.brand.name} from a CSV or Excel sheet. Rows are matched to promos by promo code and ranked
          against promos of the same type. Tiers are percentile bands, not grades: {FIVE_TIER_MIN}+ promos of a type get five bands,{" "}
          {THREE_TIER_MIN}–{FIVE_TIER_MIN - 1} get three, fewer get none. Front-end promos rank on orders; other types on revenue.
        </p>
      </header>
      <Flash error={query.error} notice={query.notice} />

      {upload?.status === "IMPORTING" ? (
        <div className="flex items-center gap-3 rounded-xl border border-[#c7d7fe] bg-[#eef4ff] px-4 py-3 text-sm text-[#1e3a8a]">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-[#1e3a8a] border-t-transparent" aria-hidden />
          Importing {upload.filename}… <AutoRefresh everyMs={2500} />
        </div>
      ) : null}
      {upload?.status === "DONE" ? (
        <p className="rounded-md border border-[#abefc6] bg-[#ecfdf3] px-3 py-2 text-sm text-[#067647]">
          Imported {upload.filename}: {upload.rowCount} rows, {upload.codeCount} promo codes, {upload.matchedCount} matched to a promo.
        </p>
      ) : null}
      {upload?.status === "FAILED" && upload.error ? (
        <p className="rounded-md border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm text-[#912018]">Import failed: {upload.error}</p>
      ) : null}

      {upload && guessed && writable ? (
        <section className="space-y-4 rounded-xl border border-line bg-white p-5">
          <div>
            <h2 className="font-semibold">Map the columns of {upload.filename}</h2>
            <p className="text-sm text-muted">We guessed from the headers. Rows with the same code are added together. Unmapped columns are kept as extra detail.</p>
          </div>
          <TableScroll>
            <table className="w-full text-xs">
              <tbody>
                {preview.map((row, i) => (
                  <tr key={i} className={i === 0 ? "bg-canvas font-semibold" : "border-t border-line"}>
                    {upload.headers.map((_, c) => (
                      <td key={c} className="max-w-[180px] truncate px-2 py-1.5">{row[c] ?? ""}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          <form action={confirmPerformanceImport} className="space-y-4">
            <input type="hidden" name="importId" value={upload.id} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {PERFORMANCE_FIELDS.map((item) => (
                <label key={item.key} className="block text-sm">
                  <span className="font-medium">{item.label}{item.required ? " *" : ""}</span>
                  <select name={`map_${item.key}`} defaultValue={String(guessed[item.key] ?? -1)} className="pc-control mt-1 w-full">
                    <option value="-1">— none —</option>
                    {upload.headers.map((header, i) => (
                      <option key={i} value={i}>{header}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit">Import results</Button>
            </div>
          </form>
          <form action={discardPerformanceImport}>
            <input type="hidden" name="importId" value={upload.id} />
            <button className="text-sm text-[#b42318] hover:underline">Discard this upload</button>
          </form>
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
        {writable ? (
          <form action={uploadPerformanceSheet} className="space-y-3 rounded-xl border border-line bg-white p-5">
            <h2 className="font-semibold">Upload results</h2>
            <input
              name="file"
              type="file"
              accept=".csv,.tsv,.xlsx"
              required
              className="block w-full rounded-md border border-dashed border-line bg-canvas px-3 py-5 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
            />
            <p className="text-xs text-muted">.csv or .xlsx (first sheet), up to 10 MB. Columns: promo code, dates, mailed/sent, views, clicks, orders, revenue, cost. Re-importing a code replaces its numbers.</p>
            <Button type="submit" variant="secondary">Upload and map columns</Button>
          </form>
        ) : null}
        <section className="space-y-3 rounded-xl border border-line bg-white p-5">
          <h2 className="font-semibold">Summary</h2>
          <p className="text-sm">
            {allRecords.length} promo codes with results · {matched} matched to a promo
            {unmatchedCount ? (
              <>
                {" · "}
                <Link href={showUnmatched ? "/promo-studio/performance" : "/promo-studio/performance?show=unmatched"} className="text-accent hover:underline">
                  {showUnmatched ? "show all" : `${unmatchedCount} unmatched`}
                </Link>
              </>
            ) : null}
          </p>
          <ul className="space-y-1 text-sm">
            {[...cohorts.entries()].map(([key, cohort]) => (
              <li key={key} className="flex justify-between gap-2">
                <span className="min-w-0 truncate">{key}</span>
                <span className="shrink-0 text-muted">n={cohort.n} · {cohort.scheme ?? "no tiers"}</span>
              </li>
            ))}
          </ul>
          {writable ? (
            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              <form action={rematchPerformance}><Button type="submit" variant="secondary" size="sm">Re-match codes</Button></form>
              <form action={teachPerformanceBrain}><Button type="submit" variant="secondary" size="sm">Teach the Brain</Button></form>
            </div>
          ) : null}
          <p className="text-xs text-muted">Teach the Brain writes the tier counts and top performers per type to {ctx.brand.name}&apos;s Brain. Numbers come straight from the sheet.</p>
        </section>
      </div>

      <details id="sheet" className="rounded-xl border border-line bg-white p-5" open={query.sheet === "1" || sheetBusy}>
        <summary className="cursor-pointer font-semibold">
          Google Sheets sync{" "}
          <span className="text-sm font-normal text-muted">
            {sheet ? (sheet.enabled ? `· on, every ${sheet.everyHours}h` : "· connected, scheduled sync off") : "· not connected"}
            {sheet?.lastSyncAt ? ` · last ${sheet.lastSyncAt.toISOString().slice(0, 16).replace("T", " ")} UTC` : ""}
          </span>
        </summary>
        <div className="mt-3 space-y-4">
          <p className="max-w-3xl text-sm text-muted">
            Pull results straight from a Google Sheet on a schedule, with your own Google service account: in Google Cloud, turn on the Google Sheets API, create a service account and a
            JSON key, then share the sheet with the service account&apos;s email as a Viewer. The key is stored encrypted and never shown again. Each sync that finds changes becomes an
            import you can undo below.
          </p>
          {sheetBusy ? (
            <p className="flex items-center gap-2 text-sm text-[#1e3a8a]">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-[#1e3a8a] border-t-transparent" aria-hidden />
              Syncing… <AutoRefresh everyMs={3000} />
            </p>
          ) : null}
          {sheet?.status === "FAILED" && sheet.lastError ? <p className="[overflow-wrap:anywhere] rounded-md border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm text-[#912018]">Last sync failed: {sheet.lastError}</p> : null}
          {sheet && sheet.status !== "FAILED" && sheet.lastError ? <p className="[overflow-wrap:anywhere] text-sm text-[#912018]">{sheet.lastError}</p> : null}
          {sheet?.clientEmail ? (
            <p className="text-sm [overflow-wrap:anywhere]">
              Service account: <code className="rounded bg-canvas px-1">{sheet.clientEmail}</code>
            </p>
          ) : null}
          {writable ? (
            <form action={saveSheetSync} className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm sm:col-span-2">
                <span className="font-medium">Sheet link or id</span>
                <input name="sheet" required defaultValue={sheet ? `https://docs.google.com/spreadsheets/d/${sheet.spreadsheetId}` : ""} className="pc-control mt-1 w-full" placeholder="https://docs.google.com/spreadsheets/d/…" />
              </label>
              <label className="block text-sm">
                <span className="font-medium">Tab or range</span>
                <input name="range" defaultValue={sheet?.range ?? "Sheet1"} maxLength={120} className="pc-control mt-1 w-full" />
              </label>
              <label className="block text-sm">
                <span className="font-medium">Sync every</span>
                <select name="everyHours" defaultValue={String(sheet?.everyHours ?? 6)} className="pc-control mt-1 w-full">
                  {SYNC_INTERVALS.map((h) => (
                    <option key={h} value={h}>{h === 1 ? "hour" : `${h} hours`}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm sm:col-span-2">
                <span className="font-medium">Service-account key (JSON){sheet?.credentials ? " · leave empty to keep the saved key" : ""}</span>
                <textarea name="credentials" rows={4} className="pc-control mt-1 w-full font-mono text-xs" autoComplete="off" spellCheck={false} placeholder='{"type": "service_account", …}' />
              </label>
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <Button type="submit" variant="secondary">{sheet ? "Save and test" : "Connect sheet"}</Button>
              </div>
            </form>
          ) : null}
          {writable && sheet && sheetGuess ? (
            <form action={saveSheetMapping} className="space-y-3 border-t border-line pt-4">
              <h3 className="text-sm font-semibold">Columns</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {PERFORMANCE_FIELDS.map((item) => (
                  <label key={item.key} className="block text-sm">
                    <span className="font-medium">{item.label}{item.required ? " *" : ""}</span>
                    <select name={`map_${item.key}`} defaultValue={String(sheetGuess[item.key] ?? -1)} className="pc-control mt-1 w-full">
                      <option value="-1">— none —</option>
                      {sheet.headers.map((header, i) => (
                        <option key={i} value={i}>{header}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" name="enabled" defaultChecked={sheet.enabled} className="h-5 w-5" /> Sync on a schedule
              </label>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" name="syncNow" value="1">Save and sync now</Button>
                <Button type="submit" variant="secondary">Save</Button>
              </div>
            </form>
          ) : null}
          {writable && sheet ? (
            <div className="flex flex-wrap gap-3 border-t border-line pt-3">
              {sheet.mapping ? (
                <form action={syncSheetNow}>
                  <Button type="submit" variant="secondary" size="sm" disabled={sheetBusy}>Sync now</Button>
                </form>
              ) : null}
              <form action={disconnectSheet}>
                <button className="inline-flex min-h-9 items-center text-sm text-[#b42318] hover:underline">Disconnect and delete the key</button>
              </form>
            </div>
          ) : null}
        </div>
      </details>

      <section className="space-y-2">
        <h2 className="font-semibold">Results</h2>
        {records.length ? (
          <TableScroll>
            <table className="w-full min-w-[1180px] text-sm">
              <thead className="bg-canvas text-left text-xs text-muted">
                <tr>
                  <th className="whitespace-nowrap px-3 py-2">Code</th>
                  <th className="whitespace-nowrap px-3 py-2">Promo</th>
                  <th className="whitespace-nowrap px-3 py-2">Dates</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right">Sent</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right">Clicks</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right">Orders</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right">Revenue</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right">Conv.</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right">ROI</th>
                  <th className="whitespace-nowrap px-3 py-2">Tier</th>
                </tr>
              </thead>
              <tbody>
                {records.map((row) => {
                  const e = enrich(row);
                  return (
                    <tr key={row.id} id={`row-${row.id}`} className="border-t border-line align-top">
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{row.promoCode}</td>
                      <td className="px-3 py-2">
                        {row.promoId ? (
                          <Link href={`/promo-studio/${row.promoId}?tab=results`} className="text-accent hover:underline">{titles.get(row.promoId) ?? row.label ?? "Promo"}</Link>
                        ) : (
                          <span className="text-muted">{row.label ?? "—"} <span className="text-xs">({row.linkedManually ? "kept unlinked" : "no promo with this code"})</span></span>
                        )}
                        <div className="text-xs text-muted">
                          {row.cohort}
                          {row.linkedManually && row.promoId ? " · linked by hand" : ""}
                        </div>
                        {writable ? (
                          <details className="mt-1 text-xs">
                            <summary className="cursor-pointer text-accent">{row.promoId ? "Change link" : "Link to a promo"}</summary>
                            <form action={linkPerformance} className="mt-2 flex w-64 flex-col gap-2">
                              <input type="hidden" name="performanceId" value={row.id} />
                              <select name="target" defaultValue={row.linkedManually ? (row.promoId ?? "none") : "auto"} className="pc-control w-full text-xs" aria-label={`Promo for ${row.promoCode}`}>
                                <option value="auto">Match by promo code</option>
                                <option value="none">No promo (keep unlinked)</option>
                                {promoTitles.map((p) => (
                                  <option key={p.id} value={p.id}>{p.title}{p.promoCode ? ` (${p.promoCode})` : ""}</option>
                                ))}
                              </select>
                              <Button type="submit" size="sm" variant="secondary">Save link</Button>
                            </form>
                          </details>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">
                        {row.startDate ? row.startDate.toISOString().slice(0, 10) : "—"}
                        {row.endDate ? ` → ${row.endDate.toISOString().slice(0, 10)}` : ""}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{fmtNumber(row.sent)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{fmtNumber(row.clicks)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{fmtNumber(row.orders)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{fmtMoney(row.revenue)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{fmtPercent(e.conversion)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{fmtPercent(e.roi, 0)}</td>
                      <td className="px-3 py-2">
                        <TierBadge tier={row.tier} title={describeTier(row)} />
                        {!row.tier ? <span className="text-xs text-muted" title={describeTier(row)}>no tier</span> : null}
                        {row.tierOverride ? (
                          <div className="mt-1 max-w-[220px] text-xs text-muted [overflow-wrap:anywhere]" title={row.tierOverrideReason ?? ""}>
                            Overridden{row.computedTier ? ` (data: ${TIER_LABELS[row.computedTier as keyof typeof TIER_LABELS] ?? row.computedTier})` : " (data: no tier)"}: {row.tierOverrideReason}
                          </div>
                        ) : null}
                        {writable ? (
                          <details className="mt-1 text-xs">
                            <summary className="cursor-pointer text-accent">{row.tierOverride ? "Change override" : "Override"}</summary>
                            <form action={overrideTier} className="mt-2 flex w-56 flex-col gap-2">
                              <input type="hidden" name="performanceId" value={row.id} />
                              <select name="tier" defaultValue={row.tierOverride ?? ""} className="pc-control w-full text-xs" aria-label={`Tier for ${row.promoCode}`}>
                                <option value="">Pick a tier</option>
                                {TIER_KEYS.map((key) => (
                                  <option key={key} value={key}>{TIER_LABELS[key]}</option>
                                ))}
                                <option value="none">No tier (exclude)</option>
                              </select>
                              <input name="reason" required minLength={5} maxLength={500} defaultValue={row.tierOverrideReason ?? ""} placeholder="Why (saved with the override)" className="pc-control w-full text-xs" />
                              <Button type="submit" size="sm" variant="secondary">Save override</Button>
                            </form>
                            {row.tierOverride ? (
                              <form action={overrideTier} className="mt-2">
                                <input type="hidden" name="performanceId" value={row.id} />
                                <input type="hidden" name="clear" value="1" />
                                <button type="submit" className="text-xs text-[#b42318] hover:underline">Use the data&apos;s tier again</button>
                              </form>
                            ) : null}
                          </details>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        ) : (
          <p className="rounded-xl border border-line bg-white p-5 text-sm text-muted">No results yet. Upload a sheet to start. Set each promo&apos;s code on its Details tab so rows can match.</p>
        )}
      </section>

      {imports.length ? (
        <section className="text-sm">
          <h2 className="mb-1 font-semibold">Recent uploads</h2>
          <ul className="divide-y divide-line rounded-xl border border-line bg-white">
            {imports.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <Link href={`/promo-studio/performance?import=${item.id}`} className="pc-break min-w-0 text-accent hover:underline">
                  {item.source === "sheet" ? "Google Sheet sync" : item.filename}
                </Link>
                <span className="flex flex-wrap items-center gap-2 text-muted">
                  <span>
                    {item.createdAt.toISOString().slice(0, 10)} · {item.undoneAt ? "undone" : item.status.toLowerCase()} · {item.codeCount} codes, {item.matchedCount} matched
                  </span>
                  {writable && item.status === "DONE" && !item.undoneAt ? (
                    <form action={undoPerformanceImport} className="flex items-center gap-2">
                      <input type="hidden" name="importId" value={item.id} />
                      <label className="flex items-center gap-1 text-xs">
                        <input type="checkbox" required className="h-4 w-4" aria-label={`Confirm undo of ${item.filename}`} /> sure
                      </label>
                      <button type="submit" className="inline-flex min-h-9 items-center rounded-md border border-line bg-white px-2 text-xs font-semibold text-[#b42318] hover:bg-canvas" title={`Removes the ${item.createdCodes.length} codes it added and puts back the numbers it replaced`}>
                        Undo import
                      </button>
                    </form>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
