import Link from "next/link";
import { notFound } from "next/navigation";
import { tenantDb } from "@pubcommand/db";
import { TableScroll } from "@/components/table-scroll";
import { Flash } from "@/components/ui";
import { importStatsAction } from "@/features/calendar/actions";
import { calendarPage, UUID } from "@/features/calendar/context";
import { StatsImportForm } from "@/features/calendar/stats-import-form";
import { Section } from "@/features/calendar/ui";
import { fmtDayFull } from "../../../../../../../../../modules/editorial/dates";
import { unmatchedLabels, type UnmatchedRow } from "../../../../../../../../../modules/editorial/stats";
import { Button, Input } from "@pubcommand/ui";
import { listPublications } from "@/features/calendar/data";
import { deleteListMappingAction, saveListMappingAction } from "@/features/calendar/settings-actions";
import { loadListMappings } from "@/features/calendar/stats";
import { SEND_STATS_ENABLED } from "../../../../../../../../../modules/editorial/features";

export default async function StatsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ import?: string; error?: string; notice?: string }> }) {
  if (!SEND_STATS_ENABLED) notFound();
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await calendarPage(slug);
  if (!ctx) notFound();
  const db = tenantDb(ctx.resolved.id);
  const [imports, matchedCount, mappingRows, mappings, publications] = await Promise.all([
    db.calendarStatImport.findMany({
      where: { brandId: ctx.brand.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, filename: true, rowsParsed: true, matched: true, unmatched: true, createdAt: true },
    }),
    db.calendarSendStat.count({ where: { issue: { brandId: ctx.brand.id, deletedAt: null } } }),
    db.calendarListMapping.findMany({ where: { brandId: ctx.brand.id }, orderBy: { label: "asc" }, take: 500 }),
    loadListMappings(ctx.resolved.id, ctx.brand.id),
    listPublications(ctx.resolved.id, ctx.brand.id),
  ]);
  const selectedId = query.import && UUID.test(query.import) ? query.import : imports[0]?.id;
  const selected = selectedId ? await db.calendarStatImport.findFirst({ where: { id: selectedId, brandId: ctx.brand.id } }) : null;
  const unmatched = (selected?.unmatchedRows as UnmatchedRow[] | null) ?? [];
  const labels = unmatchedLabels(unmatched, mappings).filter((l) => !l.mapped).slice(0, 20);
  const back = selected ? `/editorial/stats?import=${selected.id}` : "/editorial/stats";
  const pubOptions = (
    <>
      <option value="">Ignore this list</option>
      {publications.map((p) => (
        <option key={p.id} value={p.code}>
          {p.code} · {p.name}
        </option>
      ))}
    </>
  );

  return (
    <div className="max-w-4xl space-y-5">
      <Flash error={query.error} notice={query.notice} />
      <Section title="Import send stats">
        <p className="mb-3 text-sm text-muted">
          Upload a CSV export from your email platform. Each row is matched to an issue by <strong>mail date + publication code</strong> (the code is read from
          the list name, e.g. “BRIEF - The Morning Briefing”, or matched to a publication name). When one publication mails twice in a day, the subject line
          decides. Importing again replaces an issue’s stats. {matchedCount} issues have stats.
        </p>
        {ctx.canWrite ? <StatsImportForm action={importStatsAction} /> : <p className="text-sm text-muted">You need editorial.write to import.</p>}
      </Section>

      {imports.length ? (
        <Section title="Recent imports">
          <ul className="divide-y divide-line rounded-lg border border-line">
            {imports.map((imp) => (
              <li key={imp.id}>
                <Link href={`/editorial/stats?import=${imp.id}`} className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm hover:bg-canvas ${imp.id === selected?.id ? "bg-[#eef2ff]" : ""}`}>
                  <span className="min-w-0 break-words [overflow-wrap:anywhere] font-medium">{imp.filename}</span>
                  <span className="text-muted">
                    {imp.createdAt.toISOString().slice(0, 10)} · {imp.matched}/{imp.rowsParsed} matched
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {selected && labels.length && ctx.canWrite ? (
        <Section title="Remember these lists">
          <p className="mb-3 text-sm text-muted">
            These list labels did not match a publication. Say which publication each one is (or ignore it, e.g. a dedicated send), and every future import uses it.
          </p>
          <ul className="space-y-2">
            {labels.map((l) => (
              <li key={l.label}>
                <form action={saveListMappingAction} className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-2">
                  <input type="hidden" name="back" value={back} />
                  <input type="hidden" name="label" value={l.label} />
                  <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere] text-sm font-medium">
                    {l.label} <span className="text-muted">· {l.count} row{l.count === 1 ? "" : "s"}</span>
                  </span>
                  <select name="pubCode" className="pc-control max-w-full" aria-label={`Publication for ${l.label}`} defaultValue={publications[0]?.code ?? ""}>
                    {pubOptions}
                  </select>
                  <Button type="submit" variant="secondary">
                    Remember
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {selected && unmatched.length ? (
        <Section title={`Rows not matched in ${selected.filename} · ${selected.unmatched}`}>
          <p className="mb-3 text-sm text-muted">
            Fix these by adding the missing issue or publication (or correcting its mail date), then import the file again.
          </p>
          <TableScroll>
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-2 py-2">Line</th>
                  <th className="px-2 py-2">Mail date</th>
                  <th className="px-2 py-2">List</th>
                  <th className="px-2 py-2">Subject</th>
                  <th className="px-2 py-2">Why</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {unmatched.slice(0, 200).map((row) => (
                  <tr key={row.line}>
                    <td className="px-2 py-2 tabular-nums">{row.line}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{row.mailDate ? fmtDayFull(row.mailDate) : "—"}</td>
                    <td className="px-2 py-2">{row.list}</td>
                    <td className="px-2 py-2">{row.subject}</td>
                    <td className="px-2 py-2 text-muted">{row.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Section>
      ) : null}
      <Section title={`Saved list mappings · ${mappingRows.length}`}>
        <div id="mappings" />
        <p className="mb-3 text-sm text-muted">How a list label in your export maps to a publication. A saved mapping wins over reading the code from the label.</p>
        {mappingRows.length ? (
          <ul className="mb-3 divide-y divide-line rounded-lg border border-line">
            {mappingRows.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere] font-medium">{m.label}</span>
                <span className="text-muted">→ {m.pubCode || "ignored"}</span>
                {ctx.canWrite ? (
                  <form action={deleteListMappingAction}>
                    <input type="hidden" name="mappingId" value={m.id} />
                    <button type="submit" className="inline-flex h-11 w-11 items-center justify-center rounded text-muted hover:bg-canvas" aria-label={`Remove mapping for ${m.label}`}>
                      ×
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {ctx.canWrite ? (
          <form action={saveListMappingAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="back" value="/editorial/stats#mappings" />
            <div className="min-w-0 flex-1">
              <label className="text-sm font-medium" htmlFor="map-label">
                List label
              </label>
              <Input id="map-label" name="label" required maxLength={200} placeholder="Exactly as it appears in the export" className="mt-1" />
            </div>
            <select name="pubCode" className="pc-control max-w-full" aria-label="Publication" defaultValue={publications[0]?.code ?? ""}>
              {pubOptions}
            </select>
            <Button type="submit" variant="secondary">
              Save mapping
            </Button>
          </form>
        ) : null}
      </Section>
    </div>
  );
}
