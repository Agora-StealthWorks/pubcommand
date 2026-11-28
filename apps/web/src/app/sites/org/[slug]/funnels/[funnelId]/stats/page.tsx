import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { TableScroll } from "@/components/table-scroll";
import { dayLabel, funnelStats, loadFunnelForBrand } from "@/features/funnels/data";
import { funnelsAccess } from "@/features/funnels/guard";
import { NO_VALUE, funnelReport, paramBreakdown, percent, type ReportPage } from "../../../../../../../../../../modules/funnels/stats";
import { normalizeParamKey } from "../../../../../../../../../../modules/funnels/tracking";
import { loadFunnelsSettings } from "@/features/funnels/tracking-data";
import { BOT_REASON_LABELS, CLICK_LABELS, filterTraffic, isClickKind, type BotReason } from "../../../../../../../../../../modules/funnels/traffic";
import { orgTimezone } from "@/features/funnels/data";
import { tenantDb } from "@pubcommand/db";

export default async function FunnelStatsPage({ params, searchParams }: { params: Promise<{ slug: string; funnelId: string }>; searchParams: Promise<{ error?: string; notice?: string; bots?: string; range?: string; by?: string }> }) {
  const { slug, funnelId } = await params;
  const query = await searchParams;
  const access = await funnelsAccess(slug, "funnels.read", funnelId);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx } = access;
  const loaded = await loadFunnelForBrand(ctx.resolved.id, ctx.brand.id, funnelId);
  if (!loaded) notFound();
  const { funnel, days } = loaded;
  const includeBots = query.bots === "1";
  const stats = await funnelStats(ctx.resolved.id, funnel, days.map((day) => day.id), { includeBots });
  const RANGES = [["1d", "24 hours", 1], ["7d", "7 days", 7], ["30d", "30 days", 30], ["90d", "90 days", 90], ["all", "All time", 0]] as const;
  const range = RANGES.find(([key]) => key === query.range) ?? RANGES[4];
  const since = range[2] ? new Date(Date.now() - range[2] * 86_400_000) : null;
  const [timeZone, tracking] = await Promise.all([orgTimezone(ctx.resolved.id), loadFunnelsSettings(ctx.resolved.id)]);
  // "Break down by": one of the org's tracked URL parameters (Funnels → Settings).
  const requestedBy = normalizeParamKey(query.by);
  const by = requestedBy && tracking.trackedParams.includes(requestedBy) ? requestedBy : null;
  const db = tenantDb(ctx.resolved.id);
  const [rows, optinRows] = await Promise.all([
    db.funnelEvent.findMany({
      where: { funnelId: funnel.id, ...(since ? { createdAt: { gte: since } } : {}) },
      select: { dayId: true, page: true, kind: true, target: true, device: true, visitorId: true, botReason: true, createdAt: true, params: true },
      take: 200_000,
    }),
    by ? db.funnelOptin.findMany({ where: { funnelId: funnel.id, ...(since ? { createdAt: { gte: since } } : {}) }, select: { params: true }, take: 200_000 }) : Promise.resolve([]),
  ]);
  const pageList: ReportPage[] = [
    ...(funnel.siteType === "microsite" ? [{ key: "home:", page: "home", id: null, label: "Home page" }] : [{ key: "waitlist:", page: "waitlist", id: null, label: "Waitlist" }]),
    ...days.map((day) => ({ key: `day:${day.id}`, page: "day", id: day.id, label: `${dayLabel(day)}${day.title ? ` · ${day.title}` : ""}` })),
    ...loaded.navItems.filter((item) => item.kind === "page").map((item) => ({ key: `custom:${item.id}`, page: "custom", id: item.id, label: `Page · ${item.title || item.label || item.slug}` })),
    ...(funnel.closeMode === "page" ? [{ key: "close:", page: "close", id: null, label: "Close page" }] : []),
  ];
  const keptEvents = filterTraffic(rows, includeBots).kept;
  const report = funnelReport({ events: keptEvents, pages: pageList, timeZone });
  const breakdown = by ? paramBreakdown({ param: by, events: keptEvents, optins: optinRows, attribution: tracking.attribution }) : [];
  const qs = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams();
    const next = { range: range[0] === "all" ? null : range[0], bots: includeBots ? "1" : null, by, ...patch };
    for (const [key, value] of Object.entries(next)) if (value) params.set(key, value);
    const text = params.toString();
    return `/funnels/${funnel.id}/stats${text ? `?${text}` : ""}`;
  };
  const reasons = Object.entries(stats.traffic.byReason)
    .map(([reason, count]) => `${count} ${BOT_REASON_LABELS[reason as BotReason].toLowerCase()}`)
    .join(", ");
  const first = stats.days[0]?.viewers ?? 0;
  const tiles = [
    ["Visitors", stats.visitors],
    [funnel.siteType === "microsite" ? "Home page views" : "Waitlist views", stats.waitlistViews],
    ["Opt-ins", stats.optins],
    ["CTA clicks", stats.ctaClicks],
  ] as const;
  return (
    <div>
      <Link href={`/funnels/${funnel.id}`} className="text-sm font-semibold text-accent">
        ← {funnel.name}
      </Link>
      <div className="mt-1">
        <PageHeader title="Stats" description="First-party counts from the public pages. Previews are never counted. Bots, email link scanners, cloud servers and automated browsers are flagged and left out." />
      </div>
      <Flash error={query.error} notice={query.notice} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white px-4 py-3 text-sm">
        <p className="min-w-0 text-muted">
          {stats.traffic.flagged
            ? `${includeBots ? "Including" : "Left out"}: ${stats.traffic.flagged.toLocaleString("en-US")} automated event${stats.traffic.flagged === 1 ? "" : "s"} from ${stats.traffic.flaggedVisitors.toLocaleString("en-US")} visitor${stats.traffic.flaggedVisitors === 1 ? "" : "s"} (${reasons}).`
            : "No automated traffic detected."}
        </p>
        {stats.traffic.flagged ? (
          <Link href={qs({ bots: includeBots ? null : "1" })} className="font-semibold text-accent">
            {includeBots ? "People only" : "Include automated traffic"}
          </Link>
        ) : null}
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-line bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{value.toLocaleString("en-US")}</p>
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-line bg-white">
        <TableScroll>
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-2.5">Day</th>
                <th className="px-4 py-2.5 text-right">Views</th>
                <th className="px-4 py-2.5 text-right">Viewers</th>
                <th className="px-4 py-2.5 text-right">Kept from day 1</th>
                <th className="px-4 py-2.5 text-right">Avg. watched</th>
                <th className="px-4 py-2.5 text-right">Finished (≥{funnel.watchPercent}%)</th>
                <th className="px-4 py-2.5 text-right">CTA clicks</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day, index) => {
                const row = stats.days[index]!;
                return (
                  <tr key={day.id} className="border-b border-line last:border-0">
                    <td className="max-w-[260px] px-4 py-3">
                      <span className="block font-semibold">{dayLabel(day)}</span>
                      <span className="block truncate text-xs text-muted">{day.title || "Untitled"}</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.views}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.viewers}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{index === 0 ? "–" : percent(row.viewers, first)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.avgWatch === null ? "–" : `${row.avgWatch}%`}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.completed}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.ctaClicks}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      </div>
      <nav className="mb-4 mt-6 flex flex-wrap gap-1.5" aria-label="Date range">
        {RANGES.map(([key, label]) => (
          <Link key={key} href={qs({ range: key === "all" ? null : key })} aria-current={key === range[0] ? "page" : undefined} className={`inline-flex min-h-9 items-center rounded-md border px-3 text-sm font-semibold ${key === range[0] ? "border-accent bg-[#eef2ff] text-[#1e3a8a]" : "border-line bg-white"}`}>
            {label}
          </Link>
        ))}
      </nav>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(
          [
            ["Visitors", report.visitors],
            ["Page views", report.views],
            ...Object.entries(report.devices).map(([device, count]) => [device === "unknown" ? "Device not recorded" : `${device[0]!.toUpperCase()}${device.slice(1)} visitors`, count] as const),
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="rounded-xl border border-line bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{value.toLocaleString("en-US")}</p>
          </div>
        ))}
      </div>
      <h2 className="mb-2 text-base font-semibold">By URL parameter</h2>
      <div className="mb-6 rounded-xl border border-line bg-white">
        {tracking.trackedParams.length ? (
          <form method="get" action={`/funnels/${funnel.id}/stats`} className="flex flex-wrap items-end gap-2 border-b border-line px-4 py-3">
            {range[0] !== "all" ? <input type="hidden" name="range" value={range[0]} /> : null}
            {includeBots ? <input type="hidden" name="bots" value="1" /> : null}
            <label className="min-w-0 flex-1 text-sm sm:flex-none">
              <span className="block text-xs font-semibold uppercase tracking-wider text-muted">Break down by</span>
              <select name="by" defaultValue={by ?? ""} className="pc-control mt-1 w-full text-sm sm:w-56">
                <option value="">Choose a parameter</option>
                {tracking.trackedParams.map((param) => (
                  <option key={param} value={param}>
                    {param}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3.5 text-sm font-semibold hover:bg-canvas">
              Show
            </button>
            <p className="w-full text-xs text-muted">
              Each visitor counts once, under their {tracking.attribution === "last" ? "latest" : "first"} value ({tracking.attribution} touch, set in <Link href="/funnels/settings" className="text-accent">Funnels settings</Link>). Opt-ins use the value saved with the opt-in. Offer clicks are CTA, deadline-bar, close-page and home-page buttons.
            </p>
          </form>
        ) : (
          <p className="px-4 py-3 text-sm text-muted">
            No URL parameters are tracked. Add some in <Link href="/funnels/settings" className="font-semibold text-accent">Funnels settings</Link>.
          </p>
        )}
        {by ? (
          <TableScroll>
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-2.5">{by}</th>
                  <th className="px-4 py-2.5 text-right">Visitors</th>
                  <th className="px-4 py-2.5 text-right">Opt-ins</th>
                  <th className="px-4 py-2.5 text-right">Views</th>
                  <th className="px-4 py-2.5 text-right">Offer clicks</th>
                  <th className="px-4 py-2.5 text-right">Click rate</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((row) => (
                  <tr key={row.value} className="border-b border-line last:border-0">
                    <td className={`max-w-[280px] truncate px-4 py-3 ${row.value === NO_VALUE ? "text-muted" : "font-semibold"}`} title={row.value}>
                      {row.value}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.visitors.toLocaleString("en-US")}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.optins.toLocaleString("en-US")}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.views.toLocaleString("en-US")}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.offerClicks.toLocaleString("en-US")}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.clickRate}%</td>
                  </tr>
                ))}
                {breakdown.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-muted">
                      No visits in this range.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </TableScroll>
        ) : null}
      </div>
      <h2 className="mb-2 text-base font-semibold">Pages</h2>
      <div className="mb-6 rounded-xl border border-line bg-white">
        <TableScroll>
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-2.5">Page</th>
                <th className="px-4 py-2.5 text-right">Views</th>
                <th className="px-4 py-2.5 text-right">Visitors</th>
                <th className="px-4 py-2.5 text-right">% of visitors</th>
                <th className="px-4 py-2.5">Devices</th>
                <th className="px-4 py-2.5 text-right">CTA</th>
                <th className="px-4 py-2.5 text-right">Resources</th>
                <th className="px-4 py-2.5 text-right">Calendar</th>
                <th className="px-4 py-2.5 text-right">Live</th>
              </tr>
            </thead>
            <tbody>
              {report.pages.map((row) => (
                <tr key={row.key} className="border-b border-line last:border-0">
                  <td className="max-w-[280px] truncate px-4 py-3 font-semibold">{row.label}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{row.views}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{row.uniques}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{row.pctOfUsers}%</td>
                  <td className="px-4 py-3 text-xs text-muted">{Object.entries(row.devices).map(([device, count]) => `${device} ${count}`).join(" · ") || "–"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{row.clicks.cta ?? 0}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{row.clicks.resource ?? 0}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{row.clicks.calendar ?? 0}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{(row.clicks.live_join ?? 0) + (row.clicks.live_redirect ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </div>
      <h2 className="mb-2 text-base font-semibold">Buttons and links</h2>
      <div className="mb-6 rounded-xl border border-line bg-white">
        <TableScroll>
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-2.5">Page</th>
                <th className="px-4 py-2.5">What</th>
                <th className="px-4 py-2.5">Label / link</th>
                <th className="px-4 py-2.5 text-right">Clicks</th>
                <th className="px-4 py-2.5 text-right">Visitors</th>
                <th className="px-4 py-2.5 text-right">Click rate</th>
              </tr>
            </thead>
            <tbody>
              {report.clicks.map((row, index) => (
                <tr key={index} className="border-b border-line last:border-0">
                  <td className="max-w-[200px] truncate px-4 py-3">{row.pageLabel}</td>
                  <td className="px-4 py-3">{isClickKind(row.kind) ? CLICK_LABELS[row.kind] : row.kind}</td>
                  <td className="max-w-[280px] truncate px-4 py-3 text-xs text-muted" title={row.target}>{row.target || "–"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{row.clicks}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{row.uniques}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{row.ctr}%</td>
                </tr>
              ))}
              {report.clicks.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted">
                    No clicks yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </TableScroll>
      </div>
      {report.daily.length ? (
        <>
          <h2 className="mb-2 text-base font-semibold">By day ({timeZone})</h2>
          <div className="mb-6 rounded-xl border border-line bg-white">
            <TableScroll>
              <table className="w-full min-w-[360px] text-sm">
                <thead className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                  <tr>
                    <th className="px-4 py-2.5">Date</th>
                    <th className="px-4 py-2.5 text-right">Views</th>
                    <th className="px-4 py-2.5 text-right">Visitors</th>
                  </tr>
                </thead>
                <tbody>
                  {report.daily.map((row) => (
                    <tr key={row.date} className="border-b border-line last:border-0">
                      <td className="px-4 py-3 tabular-nums">{row.date}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.views}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.uniques}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </div>
        </>
      ) : null}
    </div>
  );
}
