import Link from "next/link";
import { Denied } from "@/components/ui";
import { ispyOrgScope, qs } from "@/features/ispy/org-data";
import { FeedLocked, FeedSwitcher } from "@/features/ispy/org-ui";
import { trendWeek, trendWeeks } from "@/features/ispy/read";
import { isoDay, parseWeek, weekLabel, weekStartOf } from "../../../../../../../../../modules/intel/index";
import { EMAIL_TYPE_LABELS, FEED_LABELS, type IspyEmailType, type TrendStats } from "../../../../../../../../../modules/ispy/index";

const WEEK = 7 * 86_400_000;
const pct = (n: number) => `${Math.round(n * 100)}%`;

function Bars({ rows, color = "bg-accent" }: { rows: { name: string; value: number; label: string }[]; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="text-sm text-muted">Nothing yet.</p>;
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.name} className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)_auto] items-center gap-3 text-sm">
          <span className="pc-break text-ink">{r.name}</span>
          <span className="h-2.5 rounded bg-canvas">
            <span className={`block h-2.5 rounded ${color}`} style={{ width: `${Math.max(4, (r.value / max) * 100)}%` }} />
          </span>
          <span className="whitespace-nowrap text-right font-semibold tabular-nums text-ink">{r.label}</span>
        </li>
      ))}
    </ul>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border border-line bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}

export default async function IspyTrendsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { slug } = await params;
  const search = await searchParams;
  const found = await ispyOrgScope(slug, search.feed);
  if (!found.ok) return <Denied title={found.error} />;
  const { viewer, feed, locked, feeds } = found.value;
  const feedParam = feeds.length > 1 || feed !== feeds[0] ? feed : undefined;
  const header = (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted">Niche-wide: what the whole {FEED_LABELS[feed]} feed mailed, week by week.</p>
      <FeedSwitcher base="/intel/trends" feed={feed} />
    </div>
  );
  if (locked) {
    return (
      <div className="min-w-0">
        {header}
        <FeedLocked feed={feed} base="/intel/trends" />
      </div>
    );
  }
  const weeks = await trendWeeks(feed, 12);
  const weekStart = parseWeek(search.week) ?? weeks[0]?.weekStart ?? new Date(weekStartOf(new Date()).getTime() - WEEK);
  const row = await trendWeek(viewer, feed, weekStart);
  const stats = (row?.stats ?? null) as TrendStats | null;
  const weekHref = (d: Date) => `/intel/trends${qs({ feed: feedParam, week: isoDay(d) })}`;

  return (
    <div className="min-w-0">
      {header}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-ink">
          {FEED_LABELS[feed]} · {weekLabel(weekStart)}
        </h2>
        <span className="ml-auto flex flex-wrap gap-3 text-sm">
          <Link href={weekHref(new Date(weekStart.getTime() - WEEK))} className="text-accent underline">
            ← Previous week
          </Link>
          {weekStart.getTime() + 2 * WEEK <= Date.now() ? (
            <Link href={weekHref(new Date(weekStart.getTime() + WEEK))} className="text-accent underline">
              Next week →
            </Link>
          ) : null}
        </span>
      </div>
      {!stats ? (
        <div className="rounded-xl border border-line bg-white p-6 text-sm text-muted">
          No trends for this week yet. They are built every Monday morning for the week before.
          {weeks.length ? (
            <span className="mt-2 block">
              Ready:{" "}
              {weeks.map((w, i) => (
                <span key={isoDay(w.weekStart)}>
                  {i ? ", " : ""}
                  <Link href={weekHref(w.weekStart)} className="text-accent underline">
                    {weekLabel(w.weekStart)}
                  </Link>
                </span>
              ))}
            </span>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          {row?.narrative ? (
            <div className="rounded-xl border border-[#c7d6fb] bg-[#f3f7ff] p-4 text-sm text-ink">
              <strong>This week in {FEED_LABELS[feed]}.</strong> {row.narrative}
              <span className="mt-1 block text-xs text-muted">Written from the numbers below in one short AI call. Saved to the Master Brain and your Brain.</span>
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-4">
            <Card title="Emails">
              <p className="text-2xl font-extrabold text-ink">{stats.emails.toLocaleString("en-US")}</p>
            </Card>
            <Card title="New promos">
              <p className="text-2xl font-extrabold text-ink">{stats.newPromos}</p>
            </Card>
            <Card title="Types">
              <ul className="space-y-0.5 text-xs text-ink">
                {Object.entries(stats.types)
                  .sort((a, b) => b[1] - a[1])
                  .map(([type, n]) => (
                    <li key={type} className="flex justify-between gap-2">
                      <span>{EMAIL_TYPE_LABELS[type as IspyEmailType] ?? type}</span>
                      <span className="tabular-nums">{n}</span>
                    </li>
                  ))}
              </ul>
            </Card>
            <Card title="Most re-sent copy">
              {stats.mostResent.length ? (
                <ul className="space-y-0.5 text-xs">
                  {stats.mostResent.map((c) => (
                    <li key={c.copyId}>
                      <Link href={`/intel/copies/${c.copyId}${qs({ feed: feedParam })}`} className="text-accent underline">
                        {c.count}× sent
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">None.</p>
              )}
            </Card>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Card title="Hot topics (share of emails)">
              <Bars rows={stats.topics.map((t) => ({ name: t.name, value: t.share, label: `${pct(t.share)} ${t.share > t.prevShare ? "▲" : t.share < t.prevShare ? "▼" : "–"}` }))} />
            </Card>
            <Card title="Most-lifted advertisers">
              <Bars rows={stats.liftedAdvertisers.map((a) => ({ name: a.name, value: a.lists, label: `${a.lists} list${a.lists === 1 ? "" : "s"}` }))} color="bg-[#b45309]" />
            </Card>
            <Card title="Share of voice by publisher">
              <Bars rows={stats.publishers.map((p) => ({ name: p.name, value: p.count, label: String(p.count) }))} />
            </Card>
            <Card title="Gurus">
              <Bars rows={stats.gurus.map((g) => ({ name: g.name, value: g.count, label: String(g.count) }))} />
            </Card>
            <Card title="Offer mix">
              <Bars rows={stats.offers.map((o) => ({ name: o.bucket, value: o.count, label: String(o.count) }))} color="bg-[#067647]" />
            </Card>
            <Card title="Affiliate drops by advertiser">
              <Bars rows={stats.affiliateDrops.map((a) => ({ name: a.name, value: a.count, label: String(a.count) }))} color="bg-[#6941c6]" />
            </Card>
          </div>
          <Card title="Longest-running promos">
            {stats.topRunning.length ? (
              <ul className="space-y-1 text-sm">
                {stats.topRunning.map((p) => (
                  <li key={p.id}>
                    <Link href={`/intel/promos/${p.id}${qs({ feed: feedParam })}`} className="text-accent underline">
                      {p.headline ?? "Promo"}
                    </Link>{" "}
                    <span className="text-muted">
                      · {p.advertiser} · {p.days} days
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">None.</p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
