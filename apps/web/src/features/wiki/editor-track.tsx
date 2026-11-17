import Link from "next/link";
import type { Editor } from "@/features/pubsetup/read";
import { editorTrackData } from "@/features/trackrecord/editor-profile";
import { GainText } from "@/features/trackrecord/ui";
import type { EditorPubSummary } from "../../../../../modules/performance/attribution";
import { ClaimsTable } from "./claims-table";

/**
 * Track Record on an editor's wiki profile: summaries by publication, then the claims archive. Both span the
 * full content width. Renders nothing unless the brand is a finance brand and the viewer can read Track Record.
 */
export async function EditorTrackSections({ slug, editor }: { slug: string; editor: Editor }) {
  const data = await editorTrackData(slug, editor);
  if (!data) return null;
  const { scope, claims, categories, summaries } = data;
  const staleClaims = claims.filter((c) => c.gain.stale).length;

  return (
    <>
      {summaries.length ? (
        <section className="min-w-0 rounded-xl border border-line bg-white p-4 sm:p-5" aria-labelledby="editor-track-record">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="editor-track-record" className="text-base font-semibold">
              Track record by publication
            </h2>
            <Link href="/performance" className="text-sm text-accent hover:underline">
              Open Track Record
            </Link>
          </div>
          <p className="mb-3 text-sm text-muted">Only recommendations credited to {editor.name} are counted. Gains come from stored trades and market prices.</p>
          {!data.marketConnected ? <p className="mb-3 text-xs text-[#93370d]">Market data is not connected, so open gains use the last stored prices (marked *).</p> : null}
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {summaries.map((s) => (
              <li key={s.key} className="min-w-0">
                <SummaryCard summary={s} editorName={editor.name} canWrite={scope.canWrite} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="min-w-0 rounded-xl border border-line bg-white p-4 sm:p-5" aria-labelledby="editor-claims">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="editor-claims" className="text-base font-semibold">
            Claims archive{claims.length ? ` · ${claims.length}` : ""}
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            {data.expertId ? (
              <Link href={`/performance/archive?expert=${data.expertId}`} className="text-sm text-accent hover:underline">
                Open in the call archive
              </Link>
            ) : null}
            {scope.canWrite ? (
              <Link href={`/performance/archive/new?editor=${editor.id}`} className="inline-flex min-h-10 items-center rounded-md bg-accent px-3 text-sm font-semibold text-white">
                + Add claim
              </Link>
            ) : null}
          </div>
        </div>
        {claims.length ? (
          <>
            <p className="mb-3 text-sm text-muted">
              Historic calls by {editor.name}, with the original backup. Gains are recalculated from real prices per each call&apos;s basis.
              {staleClaims ? (
                <span className="text-[#93370d]">
                  {" "}
                  {staleClaims} use{staleClaims === 1 ? "s" : ""} a stored or recorded price because a live price was not available (marked *).
                </span>
              ) : null}
            </p>
            <ClaimsTable claims={claims} categories={categories} />
          </>
        ) : (
          <p className="text-sm text-muted">No archived calls for {editor.name} yet.</p>
        )}
      </section>
    </>
  );
}

function SummaryStat({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="truncate text-base font-semibold tabular-nums">{children}</dd>
      {hint ? <dd className="truncate text-xs text-muted">{hint}</dd> : null}
    </div>
  );
}

const rate = (value: number | null) => (value == null ? "—" : `${Math.round(value * 100)}%`);

function SummaryCard({ summary: s, editorName, canWrite }: { summary: EditorPubSummary; editorName: string; canWrite: boolean }) {
  const { stats } = s;
  return (
    <div className="flex h-full min-w-0 flex-col rounded-lg border border-line p-3">
      <div className="mb-2 min-w-0">
        <h3 className="font-semibold [overflow-wrap:anywhere]">
          {s.publication ? (
            <Link href={`/wiki/publications/${s.publication.slug}`} className="hover:text-accent">
              {s.publication.name}
            </Link>
          ) : (
            s.label
          )}
        </h3>
        <p className="text-xs text-muted [overflow-wrap:anywhere]">
          {s.portfolios.map((p, i) => (
            <span key={p.id}>
              {i ? " · " : ""}
              <Link href={`/performance/${p.id}`} className="hover:text-accent hover:underline">
                {p.name}
              </Link>
            </span>
          ))}
          {s.shared ? ` · ${editorName}'s positions only` : ""}
        </p>
      </div>
      {stats.closed === 0 && stats.open === 0 ? (
        <p className="text-sm text-muted">No recommendations credited to {editorName} yet.</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
          <SummaryStat label="Closed">{stats.closed}</SummaryStat>
          <SummaryStat label="Win rate" hint={stats.closed ? `${stats.winners} of ${stats.closed}` : undefined}>
            {rate(stats.winRate)}
          </SummaryStat>
          <SummaryStat label="Average gain">
            <GainText pct={stats.avgGain} />
          </SummaryStat>
          <SummaryStat label="Best gain" hint={stats.best?.symbol}>
            <GainText pct={stats.best?.gainPct ?? null} />
          </SummaryStat>
          <SummaryStat label="Open">{stats.open}</SummaryStat>
          <SummaryStat label="Avg open gain" hint={stats.open ? `${stats.openPriced} priced` : undefined}>
            <GainText pct={stats.avgOpenGain} />
            {s.staleCount ? <span className="font-semibold text-[#b54708]">*</span> : null}
          </SummaryStat>
        </dl>
      )}
      {s.staleCount ? <p className="mt-2 text-xs text-muted">* {s.staleCount} open position{s.staleCount === 1 ? "" : "s"} priced from a stored or recorded price.</p> : null}
      {canWrite && s.unassigned.length ? (
        <ul className="mt-2 space-y-1 border-t border-line pt-2 text-xs text-[#93370d]">
          {s.unassigned.map((n) => (
            <li key={n.portfolioId}>
              <Link href={`/performance/${n.portfolioId}`} className="hover:underline">
                {n.count} position{n.count === 1 ? "" : "s"} in {n.portfolioName} not assigned to an editor
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
