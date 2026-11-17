import { Button } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { TableScroll } from "@/components/table-scroll";
import { refreshFunnelBrain } from "@/features/funnels/actions";
import { dayLabel, funnelStats, loadFunnelForBrand } from "@/features/funnels/data";
import { funnelsAccess } from "@/features/funnels/guard";
import { percent } from "../../../../../../../../../../modules/funnels/stats";
import { BOT_REASON_LABELS, type BotReason } from "../../../../../../../../../../modules/funnels/traffic";

export default async function FunnelStatsPage({ params, searchParams }: { params: Promise<{ slug: string; funnelId: string }>; searchParams: Promise<{ error?: string; notice?: string; bots?: string }> }) {
  const { slug, funnelId } = await params;
  const query = await searchParams;
  const access = await funnelsAccess(slug, "funnels.read", funnelId);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx, canWrite } = access;
  const loaded = await loadFunnelForBrand(ctx.resolved.id, ctx.brand.id, funnelId);
  if (!loaded) notFound();
  const { funnel, days } = loaded;
  const includeBots = query.bots === "1";
  const stats = await funnelStats(ctx.resolved.id, funnel, days.map((day) => day.id), { includeBots });
  const reasons = Object.entries(stats.traffic.byReason)
    .map(([reason, count]) => `${count} ${BOT_REASON_LABELS[reason as BotReason].toLowerCase()}`)
    .join(", ");
  const first = stats.days[0]?.viewers ?? 0;
  const tiles = [
    ["Visitors", stats.visitors],
    ["Waitlist views", stats.waitlistViews],
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
          <Link href={`/funnels/${funnel.id}/stats${includeBots ? "" : "?bots=1"}`} className="font-semibold text-accent">
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
      {canWrite && funnel.status === "published" && funnel.brainSyncEnabled ? (
        <form action={refreshFunnelBrain} className="mt-4">
          <input type="hidden" name="funnelId" value={funnel.id} />
          <Button type="submit" variant="secondary">
            Send the latest figures to the Brain
          </Button>
          <p className="mt-1 text-xs text-muted">The note holds the agenda and these aggregates only, never opt-in emails.</p>
        </form>
      ) : null}
    </div>
  );
}
