import { Button } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TableScroll } from "@/components/table-scroll";
import { Flash } from "@/components/ui";
import { calendarPage } from "@/features/calendar/context";
import { listPublications } from "@/features/calendar/data";
import { refreshTickersAction } from "@/features/calendar/settings-actions";
import { loadTickerRows, marketConfigured, showsTickers } from "@/features/calendar/tickers";
import { PubChip } from "@/features/calendar/ui";
import { fmtDayFull } from "../../../../../../../../../modules/editorial/dates";

type Sort = "date" | "ticker" | "peak" | "current";

function move(n: number | null | undefined) {
  if (n == null) return <span className="text-muted">—</span>;
  return <span className={n >= 0 ? "text-[#067647]" : "text-[#b42318]"}>{`${n >= 0 ? "+" : ""}${n.toFixed(1)}%`}</span>;
}

const price = (n: number | null | undefined) => (n == null ? "—" : `$${n.toFixed(2)}`);

export default async function TickersPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string; sort?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await calendarPage(slug);
  // A finance-only view: other brands never see it.
  if (!ctx || !showsTickers(ctx.brand)) notFound();
  const [rows, publications] = await Promise.all([loadTickerRows(ctx.resolved.id, ctx.brand.id), listPublications(ctx.resolved.id, ctx.brand.id, true)]);
  const color = new Map(publications.map((p) => [p.code, p.color]));
  const sort: Sort = (["date", "ticker", "peak", "current"] as const).find((s) => s === query.sort) ?? "date";
  const sorted = [...rows].sort((a, b) => {
    if (sort === "ticker") return a.ticker.localeCompare(b.ticker) || b.mailDate.localeCompare(a.mailDate);
    if (sort === "peak") return (b.price?.peakPct ?? -1e9) - (a.price?.peakPct ?? -1e9);
    if (sort === "current") return (b.price?.currentPct ?? -1e9) - (a.price?.currentPct ?? -1e9);
    return b.mailDate.localeCompare(a.mailDate);
  });
  const priced = rows.filter((r) => r.price?.current != null).length;
  const head = (key: Sort, label: string) => (
    <th className="px-2 py-2">
      <Link href={key === "date" ? "/editorial/tickers" : `/editorial/tickers?sort=${key}`} className={sort === key ? "text-accent" : "hover:text-ink"}>
        {label}
      </Link>
    </th>
  );

  return (
    <div className="space-y-4">
      <Flash error={query.error} notice={query.notice} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold">Tickers mentioned in editorial</h2>
          <p className="text-sm text-muted">
            Every ticker listed on an issue, with its close on the mail date, the highest close since and the latest close. Prices come from market data and refresh every
            weekday evening{priced ? ` (${priced} of ${rows.length} priced)` : ""}.
          </p>
        </div>
        {ctx.canWrite && marketConfigured() ? (
          <form action={refreshTickersAction}>
            <Button type="submit" variant="secondary">
              Refresh prices
            </Button>
          </form>
        ) : null}
      </div>
      {!marketConfigured() ? (
        <p className="rounded-lg border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">Market data is not connected yet, so prices are not shown.</p>
      ) : null}
      {rows.length === 0 ? (
        <p className="rounded-xl border border-line bg-white p-4 text-sm text-muted">No tickers yet. Add them to an issue (the “Tickers mentioned” field).</p>
      ) : (
        <div className="rounded-xl border border-line bg-white">
          <TableScroll>
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr>
                  {head("ticker", "Ticker")}
                  {head("date", "Mail date")}
                  <th className="px-2 py-2">Issue</th>
                  <th className="px-2 py-2 text-right">Issue close</th>
                  <th className="px-2 py-2 text-right">Peak</th>
                  {head("peak", "Peak move")}
                  <th className="px-2 py-2 text-right">Latest</th>
                  {head("current", "Move now")}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sorted.slice(0, 1000).map((r) => (
                  <tr key={`${r.ticker}-${r.issueId}`}>
                    <td className="px-2 py-2 font-semibold">{r.ticker}</td>
                    <td className="whitespace-nowrap px-2 py-2">{fmtDayFull(r.mailDate)}</td>
                    <td className="px-2 py-2">
                      <span className="flex items-center gap-1.5">
                        <PubChip code={r.publicationCode} color={color.get(r.publicationCode)} />
                        <Link href={`/editorial/issues/${r.issueId}`} className="break-words [overflow-wrap:anywhere] hover:text-accent">
                          {r.title}
                        </Link>
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{price(r.price?.issueClose)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{price(r.price?.peak)}</td>
                    <td className="px-2 py-2 tabular-nums">{move(r.price?.peakPct)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{price(r.price?.current)}</td>
                    <td className="px-2 py-2 tabular-nums" title={r.price?.error ?? undefined}>
                      {move(r.price?.currentPct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </div>
      )}
    </div>
  );
}
