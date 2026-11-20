import { aiConfigured } from "@pubcommand/ai";
import { tenantDb } from "@pubcommand/db";
import { Button } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TableScroll } from "@/components/table-scroll";
import { regenerateWhatsWorkingAction } from "@/features/calendar/actions";
import { AutoRefresh } from "@/features/calendar/auto-refresh";
import { calendarPage } from "@/features/calendar/context";
import { listPublications } from "@/features/calendar/data";
import { PubChip, Section } from "@/features/calendar/ui";
import { isStale } from "@/features/calendar/whats-working";
import { formatStat } from "../../../../../../../../../modules/editorial/analytics";
import { fmtDay, fmtDayFull, toDay } from "../../../../../../../../../modules/editorial/dates";
import type { RankedIssue, WhatsWorkingAi, WorkingFacts } from "../../../../../../../../../modules/editorial/whats-working";
import { WHATS_WORKING_ENABLED } from "../../../../../../../../../modules/editorial/features";

const lift = (v: number | null) => (v == null ? "—" : `${v >= 1 ? "+" : "−"}${Math.abs(Math.round((v - 1) * 100))}%`);

function IssueTable({ rows, why, color }: { rows: RankedIssue[]; why?: Map<string, string>; color: Map<string, string> }) {
  return (
    <TableScroll>
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-2 py-2">Issue</th>
            <th className="whitespace-nowrap px-2 py-2 text-right">Mailed</th>
            <th className="whitespace-nowrap px-2 py-2 text-right">Open</th>
            <th className="whitespace-nowrap px-2 py-2 text-right">Click</th>
            <th className="whitespace-nowrap px-2 py-2 text-right">Rev / 1,000</th>
            <th className="whitespace-nowrap px-2 py-2 text-right" title="Click rate versus this publication's rate over the window">Click vs pub</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line align-top">
          {rows.map((r) => (
            <tr key={r.issueId}>
              <td className="px-2 py-2">
                <Link href={`/editorial/issues/${r.issueId}`} className="flex items-center gap-2 font-medium hover:text-accent">
                  <PubChip code={r.pub} color={color.get(r.pub)} />
                  <span className="break-words [overflow-wrap:anywhere]">{r.title}</span>
                </Link>
                <p className="mt-0.5 text-xs text-muted">
                  {fmtDay(r.day)}
                  {r.subject ? ` · “${r.subject}”` : ""}
                </p>
                {why?.get(r.issueId) ? <p className="mt-1 text-sm">{why.get(r.issueId)}</p> : null}
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{formatStat(r.mailed, "count")}</td>
              <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{formatStat(r.openRate, "pct")}</td>
              <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{formatStat(r.clickRate, "pct")}</td>
              <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{formatStat(r.revenuePerThousand, "usd")}</td>
              <td className={`whitespace-nowrap px-2 py-2 text-right font-semibold tabular-nums ${r.clickLift != null && r.clickLift >= 1 ? "text-[#067647]" : "text-[#b42318]"}`}>{lift(r.clickLift)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

export default async function WhatsWorkingPage({ params }: { params: Promise<{ slug: string }> }) {
  if (!WHATS_WORKING_ENABLED) notFound();
  const { slug } = await params;
  const ctx = await calendarPage(slug);
  if (!ctx) notFound();
  const db = tenantDb(ctx.resolved.id);
  const [latest, publications] = await Promise.all([
    db.calendarInsight.findFirst({ where: { brandId: ctx.brand.id }, orderBy: { createdAt: "desc" } }),
    listPublications(ctx.resolved.id, ctx.brand.id, true),
  ]);
  const lastGood = latest?.status === "DONE" ? latest : await db.calendarInsight.findFirst({ where: { brandId: ctx.brand.id, status: "DONE" }, orderBy: { createdAt: "desc" } });
  const stale = latest ? isStale(latest.status, latest.updatedAt) : false;
  const busy = Boolean(latest && !stale && (latest.status === "QUEUED" || latest.status === "RUNNING"));
  const shown = lastGood ?? latest;
  const facts = (shown?.facts as WorkingFacts | null) ?? null;
  const ai = shown?.status === "DONE" ? (shown.content as WhatsWorkingAi | null) : null;
  const color = new Map(publications.map((p) => [p.code, p.color]));
  const why = new Map((ai?.topPerformers ?? []).map((t) => [t.issueId, t.why]));
  const pubText = new Map((ai?.publications ?? []).map((p) => [p.code, p]));

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">What&apos;s Working · last 30 days</h2>
          <p className="text-sm text-muted">
            {shown ? `Generated ${shown.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC` : "Not generated yet"}
            {facts ? ` · ${facts.sends} sends from ${fmtDayFull(facts.from)} to ${fmtDayFull(toDay(shown!.dataTo) ?? facts.to)}` : ""}
          </p>
        </div>
        {ctx.canWrite ? (
          <form action={regenerateWhatsWorkingAction}>
            <Button type="submit" disabled={busy}>
              {busy ? "Working…" : shown ? "Regenerate" : "Generate"}
            </Button>
          </form>
        ) : null}
      </div>
      {busy ? (
        <div className="flex items-center gap-3 rounded-xl border border-[#c7d7fe] bg-[#eef4ff] px-4 py-3 text-sm text-[#1e3a8a]">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-[#1e3a8a] border-t-transparent" aria-hidden />
          Ranking sends and writing the summary. This page updates by itself.
          <AutoRefresh />
        </div>
      ) : null}
      {latest?.status === "FAILED" || stale ? (
        <p className="rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
          {stale ? "The last run was interrupted. Run it again." : `No AI write-up: ${latest?.error}`}
          {facts && !ai ? " The ranking below comes straight from your send data." : ""}
        </p>
      ) : null}
      {!aiConfigured() ? <p className="text-xs text-muted">The AI key is not set, so only the data ranking is shown. Add ANTHROPIC_API_KEY to get the write-up.</p> : null}

      {ai ? (
        <Section title="Summary">
          <p className="text-sm leading-relaxed">{ai.summary}</p>
          {ai.patterns.length ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
              {ai.patterns.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
        </Section>
      ) : null}

      {facts && facts.top.length ? (
        <Section title="Top sends">
          <p className="mb-2 text-xs text-muted">Ranked from the data: click rate and revenue per 1,000 mailed count most, then opens, each compared with the send&apos;s own publication.</p>
          <IssueTable rows={facts.top} why={why} color={color} />
        </Section>
      ) : null}

      {facts && facts.publications.length ? (
        <Section title="By publication">
          <ul className="space-y-3">
            {facts.publications.map((p) => (
              <li key={p.code} className="rounded-lg border border-line p-3">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <PubChip code={p.code} color={color.get(p.code)} />
                  <span className="text-muted">
                    {p.sends} sends · open {formatStat(p.openRate, "pct")} · click {formatStat(p.clickRate, "pct")} · {formatStat(p.revenuePerThousand, "usd")} per 1,000
                  </span>
                </p>
                {pubText.get(p.code) ? (
                  <div className="mt-2 space-y-1 text-sm">
                    <p>{pubText.get(p.code)!.whatsWorking}</p>
                    <p className="text-muted">
                      <strong className="text-ink">Next:</strong> {pubText.get(p.code)!.recommendation}
                    </p>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {ai?.tryNext.length ? (
        <Section title="Try next">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {ai.tryNext.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </Section>
      ) : null}

      {facts && facts.laggards.length ? (
        <Section title="Underperformers">
          <IssueTable rows={facts.laggards} color={color} />
        </Section>
      ) : null}

      {!shown ? <p className="rounded-xl border border-line bg-white p-6 text-sm text-muted">Import send stats, then press Generate.</p> : null}
    </div>
  );
}
