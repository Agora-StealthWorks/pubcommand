import Link from "next/link";
import { Denied, Flash } from "@/components/ui";
import { ispyOrgScope, qs } from "@/features/ispy/org-data";
import { FeedLocked, FeedSwitcher, PromoKindBadge, SortLink, shortDay } from "@/features/ispy/org-ui";
import { RADAR_SORTS, promoRadar, type RadarSort } from "@/features/ispy/read";
import { isoDay, parseWeek, weekLabel, weekStartOf } from "../../../../../../../../../modules/intel/index";
import { FEED_LABELS } from "../../../../../../../../../modules/ispy/index";

const WEEK = 7 * 86_400_000;

export default async function IspyPromoRadarPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { slug } = await params;
  const search = await searchParams;
  const found = await ispyOrgScope(slug, search.feed);
  if (!found.ok) return <Denied title={found.error} />;
  const { viewer, feed, locked, feeds } = found.value;
  const feedParam = feeds.length > 1 || feed !== feeds[0] ? feed : undefined;
  const header = (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted">One row per promo, by the page it lands on. Re-sends, other lists and affiliate drops add sends, not rows.</p>
      <FeedSwitcher base="/intel/promos" feed={feed} params={{ week: search.week }} />
    </div>
  );
  if (locked) {
    return (
      <div className="min-w-0">
        {header}
        <FeedLocked feed={feed} base="/intel/promos" />
      </div>
    );
  }
  const weekStart = parseWeek(search.week) ?? weekStartOf(new Date());
  const sort = (RADAR_SORTS as readonly string[]).includes(search.sort ?? "") ? (search.sort as RadarSort) : "first";
  const dir = search.dir === "asc" ? "asc" : "desc";
  const onlyNew = search.new === "1";
  const radar = await promoRadar(viewer, { feed, weekStart, sort, dir, onlyNew });
  const base = { feed: feedParam, week: search.week, new: onlyNew ? "1" : undefined };
  const sortHref = (column: string, nextDir: "asc" | "desc") => `/intel/promos${qs({ ...base, sort: column === "first" ? undefined : column, dir: nextDir === "desc" ? undefined : nextDir })}`;
  const weekHref = (d: Date) => `/intel/promos${qs({ feed: feedParam, week: isoDay(d), sort: search.sort, dir: search.dir, new: base.new })}`;
  const columns: { key: RadarSort; label: string; right?: boolean; width: string }[] = [
    { key: "headline", label: "Promo", width: "" },
    { key: "advertiser", label: "Advertiser", width: "w-[180px]" },
    { key: "kind", label: "Kind", width: "w-[110px]" },
    { key: "first", label: "First seen", width: "w-[100px]" },
    { key: "days", label: "Days", right: true, width: "w-[70px]" },
    { key: "sends", label: "Sends", right: true, width: "w-[74px]" },
    { key: "affiliates", label: "Affiliates", right: true, width: "w-[96px]" },
  ];

  return (
    <div className="min-w-0">
      {header}
      <Flash error={search.error} notice={search.notice} />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-ink">
          {FEED_LABELS[feed]} · {weekLabel(weekStart)}
        </h2>
        <span className="text-sm text-muted">
          {radar.newCount} new · {radar.running} running
        </span>
        <span className="ml-auto flex flex-wrap gap-3 text-sm">
          <Link href={weekHref(new Date(weekStart.getTime() - WEEK))} className="text-accent underline">
            ← Previous week
          </Link>
          {weekStart.getTime() + WEEK <= Date.now() ? (
            <Link href={weekHref(new Date(weekStart.getTime() + WEEK))} className="text-accent underline">
              Next week →
            </Link>
          ) : null}
          <Link href={`/intel/promos${qs({ ...base, new: onlyNew ? undefined : "1", sort: search.sort, dir: search.dir })}`} className="text-accent underline">
            {onlyNew ? "Show all running" : "Only new promos"}
          </Link>
        </span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full min-w-[760px] table-fixed border-collapse text-sm">
          <colgroup>
            {columns.map((c) => (
              <col key={c.key} className={c.width} />
            ))}
          </colgroup>
          <thead className="border-b border-line bg-[#fafbfc] text-left">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={`px-3 ${c.right ? "text-right" : ""}`}>
                  <SortLink label={c.label} column={c.key} sort={sort} dir={dir} href={sortHref} align={c.right ? "right" : "left"} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {radar.promos.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-muted">
                  No promos were seen this week.
                </td>
              </tr>
            ) : (
              radar.promos.map((p) => (
                <tr key={p.id} className="align-top hover:bg-[#f8f9fb]">
                  <td className="pc-break px-3 py-2">
                    <Link href={`/intel/promos/${p.id}${qs({ feed: feedParam })}`} className="font-semibold text-ink hover:underline">
                      {p.headline ?? p.landingUrl}
                    </Link>
                    {p.isNew ? <span className="ml-2 rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-white">New</span> : null}
                  </td>
                  <td className="pc-break px-3 py-2">{p.advertiserName}</td>
                  <td className="px-3 py-2">
                    <PromoKindBadge kind={p.kind} />
                  </td>
                  <td className="px-3 py-2 text-xs text-muted">{shortDay(p.firstSeenOn)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.daysDetected}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.sendCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.affiliateCount}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
