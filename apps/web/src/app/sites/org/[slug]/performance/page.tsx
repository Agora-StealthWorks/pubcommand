import { Button, Input, Label } from "@pubcommand/ui";
import Link from "next/link";
import { Denied, Flash } from "@/components/ui";
import { createPortfolio } from "@/features/trackrecord/actions";
import { trackAccess } from "@/features/trackrecord/context";
import { marketConnected } from "@/features/trackrecord/prices";
import { portfolioSummaries } from "@/features/trackrecord/server";
import { GainText, MarketBanner } from "@/features/trackrecord/ui";
import { formatPct } from "../../../../../../../../modules/performance/gain";

export default async function TrackRecordHome({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await trackAccess("performance.read", slug);
  if (!access.ok) return <Denied title={access.error} />;
  const { scope } = access;
  const summaries = await portfolioSummaries(scope);
  const staleCount = summaries.reduce((sum, s) => sum + s.staleCount, 0);

  return (
    <div className="space-y-4">
      <Flash error={query.error} notice={query.notice} />
      <MarketBanner connected={marketConnected()} staleCount={staleCount} />
      {summaries.length === 0 ? (
        <p className="rounded-xl border border-line bg-white p-5 text-sm text-muted">
          No portfolios yet for {scope.brandName}. Create one below, or <Link href="/performance/import" className="font-semibold text-accent">import a CSV</Link> of
          recommendations.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {summaries.map(({ portfolio, stats, staleCount: stale }) => (
            <Link key={portfolio.id} href={`/performance/${portfolio.id}`} className="block min-w-0 rounded-xl border border-line bg-white p-4 hover:border-accent">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold">{portfolio.name}</h2>
                  <p className="truncate text-xs text-muted">{portfolio.publication || "No publication set"}</p>
                </div>
                {portfolio.publicEnabled ? <span className="shrink-0 rounded-full bg-[#dbe7ff] px-2 py-0.5 text-xs font-semibold text-[#1e3a8a]">Public</span> : null}
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <div>
                  <dt className="text-xs text-muted">Open</dt>
                  <dd className="font-semibold tabular-nums">{stats.open}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Closed</dt>
                  <dd className="font-semibold tabular-nums">{stats.closed}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Win rate</dt>
                  <dd className="font-semibold tabular-nums">{stats.winRate == null ? "—" : `${Math.round(stats.winRate * 100)}%`}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Avg closed</dt>
                  <dd>
                    <GainText pct={stats.avgGain} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Avg open</dt>
                  <dd>
                    <GainText pct={stats.avgOpenGain} />
                    {stale ? <span className="text-[#b54708]">*</span> : null}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Best</dt>
                  <dd className="truncate text-xs">
                    {stats.best ? (
                      <>
                        {stats.best.symbol} {formatPct(stats.best.gainPct, 0)}
                      </>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
              </dl>
            </Link>
          ))}
        </div>
      )}
      {scope.canWrite ? (
        <form action={createPortfolio} className="grid gap-3 rounded-xl border border-line bg-white p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div>
            <Label htmlFor="portfolio-name">New portfolio</Label>
            <Input id="portfolio-name" name="name" required maxLength={120} placeholder="Portfolio name" />
          </div>
          <div>
            <Label htmlFor="portfolio-publication">Publication</Label>
            <Input id="portfolio-publication" name="publication" maxLength={120} placeholder="Newsletter or service" />
          </div>
          <Button type="submit">Create portfolio</Button>
        </form>
      ) : null}
    </div>
  );
}
