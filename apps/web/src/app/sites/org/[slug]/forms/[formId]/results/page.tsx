import { aiConfigured } from "@pubcommand/ai";
import { Button } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { TableScroll } from "@/components/table-scroll";
import { deleteResponses, generateSummary } from "@/features/forms/actions";
import { AutoRefresh } from "@/features/forms/auto-refresh";
import { latestSummary, loadResponses } from "@/features/forms/data";
import { loadForm } from "@/features/forms/data";
import { formsAccess } from "@/features/forms/guard";
import { formStats, type Bucket, type FieldStats } from "../../../../../../../../../../modules/forms/analytics";
import { exportColumns } from "../../../../../../../../../../modules/forms/export";
import { answerText } from "../../../../../../../../../../modules/forms/fields";
import { MIN_RESPONSES_FOR_SUMMARY } from "../../../../../../../../../../modules/forms/summary";
import type { ResponseRecord } from "../../../../../../../../../../modules/forms/types";

const ROW_LIMIT = 200;
const STATUSES = [
  ["complete", "Complete"],
  ["partial", "Partial"],
  ["flagged", "Flagged as spam"],
  ["all", "All"],
] as const;

function parseDay(value: string | undefined, endOfDay = false): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return endOfDay ? new Date(date.getTime() + 24 * 3600 * 1000) : date;
}

function Bars({ buckets }: { buckets: Bucket[] }) {
  return (
    <ul className="mt-2 space-y-1.5">
      {buckets.map((bucket) => (
        <li key={bucket.label} className="text-sm">
          <div className="flex justify-between gap-3">
            <span className="[overflow-wrap:anywhere] min-w-0">{bucket.label}</span>
            <span className="shrink-0 tabular-nums text-muted">
              {bucket.count} · {bucket.pct}%
            </span>
          </div>
          <div className="mt-0.5 h-2 overflow-hidden rounded-full bg-canvas">
            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(bucket.pct, bucket.count ? 1 : 0)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function QuestionCard({ stats, recent }: { stats: FieldStats; recent: string[] | null }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-white p-4">
      <p className="[overflow-wrap:anywhere] font-semibold">{stats.label || "Untitled"}</p>
      <p className="text-xs text-muted">
        {stats.answered} of {stats.base} answered
      </p>
      {stats.kind === "choice" || stats.kind === "multi" || stats.kind === "bool" ? <Bars buckets={stats.buckets} /> : null}
      {stats.kind === "numeric" ? (
        <>
          <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
            {stats.nps ? (
              <div className="rounded-md bg-canvas p-2">
                <dt className="text-[11px] text-muted">NPS</dt>
                <dd className="text-lg font-semibold">{stats.nps.score}</dd>
              </div>
            ) : null}
            <div className="rounded-md bg-canvas p-2">
              <dt className="text-[11px] text-muted">Average</dt>
              <dd className="text-lg font-semibold">{stats.mean ?? "–"}</dd>
            </div>
            <div className="rounded-md bg-canvas p-2">
              <dt className="text-[11px] text-muted">Median</dt>
              <dd className="text-lg font-semibold">{stats.median ?? "–"}</dd>
            </div>
            {!stats.nps ? (
              <div className="rounded-md bg-canvas p-2">
                <dt className="text-[11px] text-muted">Range</dt>
                <dd className="text-sm font-semibold">{stats.min === null ? "–" : `${stats.min}–${stats.max}`}</dd>
              </div>
            ) : null}
          </dl>
          {stats.nps ? (
            <p className="mt-2 text-xs text-muted">
              Promoters {stats.nps.promoters} · Passives {stats.nps.passives} · Detractors {stats.nps.detractors}
            </p>
          ) : null}
          {stats.buckets.length ? <Bars buckets={stats.buckets} /> : null}
        </>
      ) : null}
      {stats.kind === "matrix" ? (
        <div className="mt-2 space-y-3">
          {stats.rows.map((row) => (
            <div key={row.label}>
              <p className="[overflow-wrap:anywhere] text-sm font-medium">
                {row.label} <span className="text-xs font-normal text-muted">({row.answered})</span>
              </p>
              <Bars buckets={row.buckets} />
            </div>
          ))}
          {stats.multi ? <p className="text-xs text-muted">Several picks per row allowed; % of people who answered that row.</p> : null}
        </div>
      ) : null}
      {stats.kind === "ranking" ? (
        <ol className="mt-2 space-y-1 text-sm">
          {stats.items.map((item, index) => (
            <li key={item.label} className="flex justify-between gap-3 rounded-md bg-canvas px-2 py-1">
              <span className="[overflow-wrap:anywhere] min-w-0">
                {index + 1}. {item.label}
              </span>
              <span className="shrink-0 tabular-nums text-muted">
                avg {item.meanRank} · 1st {item.firstCount}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      {stats.kind === "date" ? (
        <p className="mt-2 text-sm">
          {stats.earliest ? `${stats.earliest} to ${stats.latest}` : "No dates yet."}
        </p>
      ) : null}
      {stats.kind === "text" || stats.kind === "file" ? (
        recent ? (
          recent.length ? (
            <ul className="mt-2 space-y-1 text-sm">
              {recent.map((value, index) => (
                <li key={index} className="[overflow-wrap:anywhere] rounded-md bg-canvas px-2 py-1">
                  {value}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">No answers yet.</p>
          )
        ) : (
          <p className="mt-2 text-xs text-muted">Answers are visible to people with export access.</p>
        )
      ) : null}
    </div>
  );
}

export default async function FormResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; formId: string }>;
  searchParams: Promise<{ status?: string; from?: string; to?: string; q?: string; error?: string; notice?: string }>;
}) {
  const { slug, formId } = await params;
  const query = await searchParams;
  const access = await formsAccess(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx, canWrite, canExport } = access;
  const loaded = await loadForm(ctx.resolved.id, ctx.brand.id, formId);
  if (!loaded) notFound();
  const { form, fields } = loaded;
  const [all, summary] = await Promise.all([loadResponses(ctx.resolved.id, form.id), latestSummary(ctx.resolved.id, form.id)]);
  const stats = formStats(fields, all);
  const complete = all.filter((row) => row.status === "COMPLETE" && !row.spamReason);

  const status = STATUSES.some(([key]) => key === query.status) ? query.status! : "complete";
  const from = parseDay(query.from);
  const to = parseDay(query.to, true);
  const columns = exportColumns(fields);
  const search = canExport ? (query.q ?? "").trim().toLowerCase() : "";
  const filtered: ResponseRecord[] = all.filter((row) => {
    if (status === "complete" && (row.status !== "COMPLETE" || row.spamReason)) return false;
    if (status === "partial" && (row.status !== "PARTIAL" || row.spamReason)) return false;
    if (status === "flagged" && !row.spamReason) return false;
    if (from && row.startedAt < from) return false;
    if (to && row.startedAt >= to) return false;
    if (search && !columns.some((column) => answerText(column.field, row.answers[column.field.id]).toLowerCase().includes(search))) return false;
    return true;
  });
  const exportQuery = new URLSearchParams({ status, ...(query.from ? { from: query.from } : {}), ...(query.to ? { to: query.to } : {}) }).toString();
  const busy = summary?.status === "RUNNING";
  const recentText = (fieldId: string) => {
    if (!canExport) return null;
    const column = columns.find((item) => item.field.id === fieldId);
    if (!column) return [];
    return complete
      .map((row) => answerText(column.field, row.answers[fieldId]))
      .filter(Boolean)
      .slice(0, 5);
  };
  const fileLink = (row: ResponseRecord, fieldId: string, text: string) => {
    const value = row.answers[fieldId] as { fileId?: string } | undefined;
    if (!canExport || !value?.fileId) return text;
    return (
      <a href={`/forms/${form.id}/files/${value.fileId}`} className="font-semibold text-accent">
        {text || "File"}
      </a>
    );
  };

  return (
    <div className="space-y-5">
      {busy ? <AutoRefresh /> : null}
      <div className="text-sm">
        <Link href={`/forms/${form.id}`} className="text-accent">
          ← Back to the builder
        </Link>
      </div>
      <header>
        <h1 className="[overflow-wrap:anywhere] text-2xl font-semibold tracking-tight">Results: {form.title}</h1>
        <p className="mt-1 text-sm text-muted">Figures use complete responses. Partials show where people stopped. Suspected spam is kept but held out.</p>
      </header>
      <Flash error={query.error} notice={query.notice} />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ["Complete", stats.complete],
          ["Partial", stats.partial],
          ["Flagged", stats.flagged],
          ["Completion", stats.completionRate === null ? "–" : `${stats.completionRate}%`],
          ["Median time", stats.medianSeconds === null ? "–" : `${stats.medianSeconds}s`],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-line bg-white p-4">
            <p className="text-xs text-muted">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </section>

      <section id="summary" className="rounded-xl border border-line bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">AI summary</h2>
            <p className="text-xs text-muted">Built from the counts and averages above only. No names, emails or written answers are sent to the AI or the Brain.</p>
          </div>
          {canWrite ? (
            <form action={generateSummary}>
              <input type="hidden" name="formId" value={form.id} />
              <Button type="submit" variant="secondary" size="sm" disabled={busy || stats.complete < MIN_RESPONSES_FOR_SUMMARY}>
                {busy ? "Summarizing…" : summary?.status === "DONE" ? "Refresh summary" : "Summarize results"}
              </Button>
            </form>
          ) : null}
        </div>
        {!aiConfigured() ? (
          <p className="mt-3 rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
            The AI key is not set, so summaries cannot run yet. Add <code>ANTHROPIC_API_KEY</code> in Railway.
          </p>
        ) : null}
        {stats.complete < MIN_RESPONSES_FOR_SUMMARY ? <p className="mt-3 text-sm text-muted">A summary needs at least {MIN_RESPONSES_FOR_SUMMARY} complete responses.</p> : null}
        {summary?.status === "FAILED" ? <p className="mt-3 rounded-md border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm text-[#912018]">{summary.error}</p> : null}
        {summary?.status === "DONE" && summary.result ? (
          <div className="mt-4 space-y-4 text-sm">
            <p className="text-base font-semibold">{summary.result.headline}</p>
            {summary.result.keyFindings.length ? (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Key findings</h3>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {summary.result.keyFindings.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {summary.result.questionNotes.length ? (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">By question</h3>
                <dl className="mt-1 space-y-2">
                  {summary.result.questionNotes.map((item) => (
                    <div key={item.question}>
                      <dt className="font-semibold">{item.question}</dt>
                      <dd className="text-muted">{item.note}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
            <div className="grid gap-4 md:grid-cols-2">
              {summary.result.suggestedActions.length ? (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Suggested actions</h3>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {summary.result.suggestedActions.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {summary.result.dataQuality.length ? (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Caveats</h3>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
                    {summary.result.dataQuality.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
            <p className="text-xs text-muted">
              Based on {summary.responseCount} responses · {summary.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
              {stats.complete !== summary.responseCount ? ` · ${stats.complete - summary.responseCount} new since` : ""}
            </p>
          </div>
        ) : null}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">By question</h2>
        {stats.fields.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {stats.fields.map((item) => (
              <QuestionCard key={item.fieldId} stats={item} recent={item.kind === "text" || item.kind === "file" ? recentText(item.fieldId) : null} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">This form has no questions yet.</p>
        )}
        {stats.dropOff.length || stats.sources.length ? (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {stats.dropOff.length ? (
              <div className="rounded-xl border border-line bg-white p-4">
                <p className="font-semibold">Where people stopped</p>
                <Bars buckets={stats.dropOff.map((item) => ({ label: `Page ${item.page}`, count: item.count, pct: Math.round((item.count / Math.max(1, stats.partial)) * 1000) / 10 }))} />
              </div>
            ) : null}
            {stats.sources.length ? (
              <div className="rounded-xl border border-line bg-white p-4">
                <p className="font-semibold">Traffic sources (utm_source)</p>
                <Bars buckets={stats.sources} />
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-line bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
          <h2 className="text-lg font-semibold">Responses</h2>
          <div className="flex flex-wrap gap-2">
            {canExport ? (
              <>
                <a href={`/forms/${form.id}/export?format=csv&${exportQuery}`} className="inline-flex min-h-11 items-center rounded-md border border-line px-3 text-sm font-semibold">
                  Export CSV
                </a>
                <a href={`/forms/${form.id}/export?format=xlsx&${exportQuery}`} className="inline-flex min-h-11 items-center rounded-md border border-line px-3 text-sm font-semibold">
                  Export Excel
                </a>
              </>
            ) : null}
            <a href={`/forms/${form.id}/report`} className="inline-flex min-h-11 items-center rounded-md border border-line px-3 text-sm font-semibold">
              Report PDF
            </a>
          </div>
        </div>
        {canExport ? (
          <>
            <form action={`/forms/${form.id}/results`} className="grid gap-2 border-b border-line p-4 sm:grid-cols-[repeat(4,minmax(0,1fr))_auto] sm:items-end">
              <label className="text-sm">
                <span className="mb-1 block font-medium">Show</span>
                <select name="status" defaultValue={status} className="pc-control w-full text-sm">
                  {STATUSES.map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium">From</span>
                <input type="date" name="from" defaultValue={query.from ?? ""} className="pc-control w-full text-sm" />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium">To</span>
                <input type="date" name="to" defaultValue={query.to ?? ""} className="pc-control w-full text-sm" />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium">Answer contains</span>
                <input name="q" defaultValue={query.q ?? ""} className="pc-control w-full text-sm" />
              </label>
              <Button type="submit" variant="secondary">
                Filter
              </Button>
            </form>
            <form action={deleteResponses}>
              <input type="hidden" name="formId" value={form.id} />
              <TableScroll>
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                    <tr>
                      <th className="w-10 px-3 py-2" aria-label="Select" />
                      <th className="whitespace-nowrap px-3 py-2">Started (UTC)</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="whitespace-nowrap px-3 py-2">PDF</th>
                      {columns.map((column) => (
                        <th key={column.field.id} className="min-w-[140px] max-w-[260px] px-3 py-2">
                          <span className="line-clamp-2">{column.title}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, ROW_LIMIT).map((row) => (
                      <tr key={row.id} className="border-b border-line align-top last:border-0">
                        <td className="px-3 py-2">
                          <input type="checkbox" name="responseId" value={row.id} aria-label="Select response" className="h-4 w-4" />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted">{row.startedAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                        <td className="whitespace-nowrap px-3 py-2">
                          {row.status === "COMPLETE" ? "Complete" : `Partial (page ${row.lastPageIndex + 1})`}
                          {row.spamReason ? <span className="block text-xs text-[#b42318]">Flagged: {row.spamReason}</span> : null}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">
                          <a href={`/forms/${form.id}/responses/${row.id}/pdf`} className="font-semibold text-accent" aria-label="Download this response as PDF">
                            PDF
                          </a>
                        </td>
                        {columns.map((column) => {
                          const text = answerText(column.field, row.answers[column.field.id]);
                          return (
                            <td key={column.field.id} className="max-w-[260px] px-3 py-2">
                              <span className="[overflow-wrap:anywhere] line-clamp-3">{column.field.type === "file_upload" || column.field.type === "image_upload" || column.field.type === "signature" ? fileLink(row, column.field.id, text) : text}</span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={columns.length + 4} className="px-4 py-8 text-center text-muted">
                          No responses match.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </TableScroll>
              {filtered.length > ROW_LIMIT ? <p className="border-t border-line px-4 py-2 text-xs text-muted">Showing the newest {ROW_LIMIT} of {filtered.length}. Export for all of them.</p> : null}
              <details className="border-t border-line">
                <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-[#b42318]">Delete responses</summary>
                <div className="space-y-3 px-4 pb-4 text-sm">
                  <p className="text-muted">Deleting is permanent and clears the AI summary. Pick exactly what to delete.</p>
                  <fieldset className="space-y-1">
                    <legend className="sr-only">What to delete</legend>
                    {[
                      ["selected", "The responses ticked above"],
                      ["partial", "All partial (unfinished) responses"],
                      ["flagged", "All responses flagged as spam"],
                      ["all", "Every response to this form"],
                    ].map(([value, label]) => (
                      <label key={value} className="flex min-h-9 items-center gap-2">
                        <input type="radio" name="scope" value={value} defaultChecked={value === "selected"} />
                        {label}
                      </label>
                    ))}
                  </fieldset>
                  <label className="block">
                    <span className="mb-1 block">To delete every response, type the form title: <strong className="[overflow-wrap:anywhere]">{form.title}</strong></span>
                    <input name="confirm" autoComplete="off" className="pc-control w-full max-w-md text-sm" />
                  </label>
                  <Button type="submit" variant="danger" size="sm">
                    Delete
                  </Button>
                </div>
              </details>
            </form>
          </>
        ) : (
          <p className="p-4 text-sm text-muted">Individual responses contain personal data. Ask an admin for forms.export to see and export them.</p>
        )}
      </section>
    </div>
  );
}
