import { Button, Input, Label, Textarea } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { Denied, Flash } from "@/components/ui";
import { deletePortfolio, refreshPortfolioPrices, teachPortfolioWeek, updatePortfolio, updatePublicLink, updateWidget } from "@/features/trackrecord/actions";
import { trackAccess } from "@/features/trackrecord/context";
import { marketConnected } from "@/features/trackrecord/prices";
import { getPortfolio, positionViews, refreshPositionHistory, toStat } from "@/features/trackrecord/server";
import { MarketBanner, PositionTable, StatsGrid } from "@/features/trackrecord/ui";
import { currentRequest } from "@/lib/request";
import { historyDue } from "@/features/trackrecord/prices";
import { computeStats, isoWeek } from "../../../../../../../../../modules/performance/stats";
import { embedSnippet } from "../../../../../../../../../modules/performance/widget";

const TABS = [
  { key: "positions", label: "Positions" },
  { key: "public", label: "Public view" },
  { key: "settings", label: "Settings" },
] as const;

export default async function PortfolioPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; portfolioId: string }>;
  searchParams: Promise<{ error?: string; notice?: string; tab?: string }>;
}) {
  const { slug, portfolioId } = await params;
  const query = await searchParams;
  const access = await trackAccess("performance.read", slug);
  if (!access.ok) return <Denied title={access.error} />;
  const { scope } = access;
  const portfolio = await getPortfolio(scope, portfolioId);
  if (!portfolio) notFound();
  const tab = TABS.some((t) => t.key === query.tab) ? query.tab : "positions";
  const views = await positionViews(scope.organizationId, { portfolioId: portfolio.id, brandId: scope.brandId }, { refresh: true });
  const open = views.filter((v) => v.status !== "CLOSED");
  const closed = views.filter((v) => v.status === "CLOSED").sort((a, b) => (b.exitDate?.getTime() ?? 0) - (a.exitDate?.getTime() ?? 0));
  const stats = computeStats(views.map(toStat));
  const connected = marketConnected();
  const due = views.filter((v) => v.priceSymbol && historyDue(v.peakCheckedAt, v.status === "CLOSED"));
  if (connected && due.length) after(() => refreshPositionHistory(scope.organizationId, due.slice(0, 25)).then(() => undefined));
  const request = await currentRequest();
  const publicUrl = portfolio.publicToken ? `${request.origin}/p/track-record/${portfolio.publicToken}` : null;
  const widgetUrl = portfolio.widgetToken ? `${request.origin}/p/track-record/widget/${portfolio.widgetToken}` : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href="/performance" className="text-sm text-accent">
            ← All portfolios
          </Link>
          <h2 className="mt-1 break-words text-xl font-semibold">{portfolio.name}</h2>
          <p className="text-sm text-muted">{portfolio.publication || "No publication set"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {scope.canWrite ? (
            <Link href={`/performance/${portfolio.id}/positions/new`} className="inline-flex min-h-11 items-center rounded-md bg-accent px-3.5 text-sm font-semibold text-white">
              + Add recommendation
            </Link>
          ) : null}
          <a href={`/performance/${portfolio.id}/export?view=internal`} className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3.5 text-sm font-semibold">
            Export CSV
          </a>
        </div>
      </div>
      <Flash error={query.error} notice={query.notice} />
      <nav className="flex flex-wrap gap-1 border-b border-line" aria-label="Portfolio">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/performance/${portfolio.id}${t.key === "positions" ? "" : `?tab=${t.key}`}`}
            className={`-mb-px inline-flex min-h-10 items-center border-b-2 px-3 text-sm font-semibold ${tab === t.key ? "border-accent text-accent" : "border-transparent text-muted"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "positions" ? (
        <>
          <MarketBanner connected={connected} staleCount={open.filter((v) => v.gain.stale).length} />
          <StatsGrid stats={stats} />
          <section>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Open positions · {open.length}</h3>
              {scope.canWrite ? (
                <div className="flex flex-wrap gap-2">
                  <form action={refreshPortfolioPrices}>
                    <input type="hidden" name="portfolioId" value={portfolio.id} />
                    <Button type="submit" variant="secondary" size="sm">
                      Refresh prices
                    </Button>
                  </form>
                  <form action={teachPortfolioWeek}>
                    <input type="hidden" name="portfolioId" value={portfolio.id} />
                    <Button type="submit" variant="secondary" size="sm">
                      Teach Brain ({isoWeek(new Date())})
                    </Button>
                  </form>
                </div>
              ) : null}
            </div>
            <PositionTable rows={open} portfolioId={portfolio.id} kind="open" canWrite={scope.canWrite} />
          </section>
          <section>
            <h3 className="mb-2 text-sm font-semibold">Closed positions · {closed.length}</h3>
            <PositionTable rows={closed} portfolioId={portfolio.id} kind="closed" canWrite={scope.canWrite} />
          </section>
          <p className="text-xs text-muted">
            Open gains run from entry to the latest quote; closed gains are frozen at exit. Shorts gain when the price falls. Prices from market data are split-adjusted
            and converted to the entry&apos;s basis. * marks a stored price used because a fresh quote was not available.
          </p>
        </>
      ) : null}

      {tab === "public" ? (
        <section className="space-y-3 rounded-xl border border-line bg-white p-4">
          <h3 className="text-base font-semibold">Public-safe track record</h3>
          <p className="text-sm text-muted">
            The public view lists closed recommendations in date order, with win rate, average gain, average holding period and the best trade. It never shows a
            loser count, the worst trade or a list of losers. Stats still count every closed trade. Open positions are left out unless you include them.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href={`/performance/${portfolio.id}/public`} className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3.5 text-sm font-semibold">
              Preview public view
            </Link>
            <a href={`/performance/${portfolio.id}/export?view=public`} className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3.5 text-sm font-semibold">
              Export public CSV
            </a>
          </div>
          {scope.canWrite ? (
            <div className="space-y-3 border-t border-line pt-3">
              <form action={updatePublicLink} className="flex flex-wrap items-center gap-3">
                <input type="hidden" name="portfolioId" value={portfolio.id} />
                <input type="hidden" name="mode" value="settings" />
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input type="checkbox" name="includeOpen" defaultChecked={portfolio.publicIncludeOpen} className="h-4 w-4" />
                  Include open positions in the public view
                </label>
                <Button type="submit" variant="secondary" size="sm">
                  Save
                </Button>
              </form>
              {portfolio.publicEnabled && publicUrl ? (
                <div className="space-y-2">
                  <p className="text-sm">
                    Public link (no sign-in):{" "}
                    <a href={publicUrl} className="break-all font-semibold text-accent">
                      {publicUrl}
                    </a>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <form action={updatePublicLink}>
                      <input type="hidden" name="portfolioId" value={portfolio.id} />
                      <input type="hidden" name="mode" value="rotate" />
                      <Button type="submit" variant="secondary" size="sm">
                        New link (old one stops working)
                      </Button>
                    </form>
                    <form action={updatePublicLink}>
                      <input type="hidden" name="portfolioId" value={portfolio.id} />
                      <input type="hidden" name="mode" value="disable" />
                      <Button type="submit" variant="danger" size="sm">
                        Turn off public link
                      </Button>
                    </form>
                  </div>
                </div>
              ) : (
                <form action={updatePublicLink}>
                  <input type="hidden" name="portfolioId" value={portfolio.id} />
                  <input type="hidden" name="mode" value="enable" />
                  <Button type="submit" size="sm">
                    Turn on a public link
                  </Button>
                </form>
              )}
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === "public" ? (
        <section className="space-y-3 rounded-xl border border-line bg-white p-4">
          <h3 className="text-base font-semibold">Embeddable widget</h3>
          <p className="text-sm text-muted">
            Put this portfolio&apos;s public-safe table and stats on any website with an iframe, or read them as JSON. Same rules as the public view: closed
            trades by default, date order, no loser count, no worst trade, no losers list. Turning it off or making a new link stops every old embed.
          </p>
          {portfolio.widgetEnabled && widgetUrl ? (
            <div className="space-y-3">
              <div>
                <Label htmlFor="widget-snippet">Embed code (table and stats)</Label>
                <Textarea id="widget-snippet" readOnly rows={4} className="font-mono text-xs" value={embedSnippet(widgetUrl, `${portfolio.name} track record`)} />
                <p className="mt-1 text-xs text-muted">
                  Add <code>?view=table</code> or <code>?view=stats</code> to show one part, and <code>&amp;limit=50</code> for more rows (stats always count every closed trade).
                </p>
              </div>
              <p className="text-sm">
                JSON:{" "}
                <a href={`${widgetUrl}/data`} className="break-all font-semibold text-accent">
                  {widgetUrl}/data
                </a>
              </p>
              <iframe src={`${widgetUrl}?limit=5`} title="Widget preview" className="h-[28rem] w-full rounded-lg border border-line" loading="lazy" />
              {scope.canWrite ? (
                <div className="flex flex-wrap items-center gap-2">
                  <form action={updateWidget} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="portfolioId" value={portfolio.id} />
                    <input type="hidden" name="mode" value="settings" />
                    <label className="flex min-h-11 items-center gap-2 text-sm">
                      <input type="checkbox" name="includeOpen" defaultChecked={portfolio.widgetIncludeOpen} className="h-4 w-4" />
                      Include open positions
                    </label>
                    <Button type="submit" variant="secondary" size="sm">
                      Save
                    </Button>
                  </form>
                  <form action={updateWidget}>
                    <input type="hidden" name="portfolioId" value={portfolio.id} />
                    <input type="hidden" name="mode" value="rotate" />
                    <Button type="submit" variant="secondary" size="sm">
                      New link (old embeds stop)
                    </Button>
                  </form>
                  <form action={updateWidget}>
                    <input type="hidden" name="portfolioId" value={portfolio.id} />
                    <input type="hidden" name="mode" value="disable" />
                    <Button type="submit" variant="danger" size="sm">
                      Turn off widget
                    </Button>
                  </form>
                </div>
              ) : null}
            </div>
          ) : scope.canWrite ? (
            <form action={updateWidget}>
              <input type="hidden" name="portfolioId" value={portfolio.id} />
              <input type="hidden" name="mode" value="enable" />
              <Button type="submit" size="sm">
                Turn on the widget
              </Button>
            </form>
          ) : (
            <p className="text-sm text-muted">The widget is off.</p>
          )}
        </section>
      ) : null}

      {tab === "settings" ? (
        scope.canWrite ? (
          <div className="space-y-4">
            <form action={updatePortfolio} className="space-y-3 rounded-xl border border-line bg-white p-4">
              <input type="hidden" name="portfolioId" value={portfolio.id} />
              <div>
                <Label htmlFor="pf-name">Name</Label>
                <Input id="pf-name" name="name" defaultValue={portfolio.name} maxLength={120} required />
              </div>
              <div>
                <Label htmlFor="pf-pub">Publication</Label>
                <Input id="pf-pub" name="publication" defaultValue={portfolio.publication} maxLength={120} />
              </div>
              <div>
                <Label htmlFor="pf-desc">Description</Label>
                <Textarea id="pf-desc" name="description" defaultValue={portfolio.description} rows={3} maxLength={1000} />
              </div>
              <Button type="submit">Save</Button>
            </form>
            <form action={deletePortfolio} className="space-y-3 rounded-xl border border-[#fecdca] bg-white p-4">
              <input type="hidden" name="portfolioId" value={portfolio.id} />
              <h3 className="text-sm font-semibold text-[#b42318]">Delete this portfolio</h3>
              <p className="text-sm text-muted">Its recommendations are hidden with it and its public link stops working. Type the name to confirm.</p>
              <Input name="confirm" placeholder={portfolio.name} aria-label="Portfolio name" />
              <Button type="submit" variant="danger">
                Delete portfolio
              </Button>
            </form>
          </div>
        ) : (
          <p className="rounded-xl border border-line bg-white p-4 text-sm text-muted">Only people with performance.write can change settings.</p>
        )
      ) : null}
    </div>
  );
}
