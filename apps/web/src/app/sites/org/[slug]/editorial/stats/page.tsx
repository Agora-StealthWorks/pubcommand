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
import type { UnmatchedRow } from "../../../../../../../../../modules/editorial/stats";

export default async function StatsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ import?: string; error?: string; notice?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await calendarPage(slug);
  if (!ctx) notFound();
  const db = tenantDb(ctx.resolved.id);
  const [imports, matchedCount] = await Promise.all([
    db.calendarStatImport.findMany({
      where: { brandId: ctx.brand.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, filename: true, rowsParsed: true, matched: true, unmatched: true, createdAt: true },
    }),
    db.calendarSendStat.count({ where: { issue: { brandId: ctx.brand.id, deletedAt: null } } }),
  ]);
  const selectedId = query.import && UUID.test(query.import) ? query.import : imports[0]?.id;
  const selected = selectedId ? await db.calendarStatImport.findFirst({ where: { id: selectedId, brandId: ctx.brand.id } }) : null;
  const unmatched = (selected?.unmatchedRows as UnmatchedRow[] | null) ?? [];

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
    </div>
  );
}
