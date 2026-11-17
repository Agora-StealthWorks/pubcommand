import { formatPct, formatPrice } from "../../../../../modules/performance/gain";
import type { WidgetPayload, WidgetView as View } from "../../../../../modules/performance/widget";
import { WidgetHeight } from "./widget-height";

const rate = (value: number | null) => (value == null ? "—" : `${Math.round(value * 100)}%`);
const tone = (pct: number | null) => (pct == null ? "text-muted" : pct > 0 ? "text-[#067647]" : pct < 0 ? "text-[#b42318]" : "text-ink");

/** The iframe widget. It only ever receives a WidgetPayload (see widget.ts for what that can and cannot hold). */
export function WidgetView({ data, view }: { data: WidgetPayload; view: View }) {
  const { stats } = data;
  return (
    <main className="bg-white p-3 text-ink">
      <WidgetHeight />
      <div className="mb-2 min-w-0">
        <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted">
          {data.brand}
          {data.publication ? ` · ${data.publication}` : ""}
        </p>
        <h1 className="break-words text-lg font-semibold">{data.portfolio}</h1>
      </div>
      {view !== "table" ? (
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["Closed", String(stats.closed)],
            ["Win rate", rate(stats.winRate)],
            ["Average gain", formatPct(stats.avgGain)],
            ["Avg hold", stats.avgHoldDays == null ? "—" : `${stats.avgHoldDays} days`],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0 rounded-lg border border-line p-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</p>
              <p className="truncate text-base font-semibold tabular-nums">{value}</p>
            </div>
          ))}
        </div>
      ) : null}
      {view !== "table" && stats.best ? (
        <p className="mb-3 text-sm">
          Best closed: <strong>{stats.best.symbol}</strong> <span className={`font-semibold ${tone(stats.best.gainPct)}`}>{formatPct(stats.best.gainPct)}</span>
          {stats.best.holdDays != null ? ` in ${stats.best.holdDays} days` : ""}
        </p>
      ) : null}
      {view !== "stats" ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] border-collapse text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-2 py-1.5">Symbol</th>
                <th className="px-2 py-1.5">Entry</th>
                <th className="px-2 py-1.5">Exit</th>
                <th className="px-2 py-1.5 text-right">Gain</th>
                <th className="px-2 py-1.5 text-right">Days</th>
              </tr>
            </thead>
            <tbody>
              {data.trades.map((t, i) => (
                <tr key={`${t.symbol}-${t.entryDate}-${i}`} className="border-t border-line">
                  <td className="px-2 py-1.5">
                    <span className="font-semibold">{t.symbol}</span>
                    {t.direction === "SHORT" ? <span className="text-xs text-muted"> short</span> : null}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">
                    {formatPrice(t.entryPrice)} <span className="text-xs text-muted">{t.entryDate}</span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">
                    {t.status === "OPEN" ? "Open" : formatPrice(t.exitPrice)} {t.exitDate ? <span className="text-xs text-muted">{t.exitDate}</span> : null}
                  </td>
                  <td className={`px-2 py-1.5 text-right font-semibold tabular-nums ${tone(t.gainPct)}`}>{formatPct(t.gainPct)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{t.holdDays ?? "—"}</td>
                </tr>
              ))}
              {data.trades.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-2 py-4 text-center text-muted">
                    No closed recommendations yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          {data.more ? <p className="mt-1 text-xs text-muted">Latest {data.trades.length} shown; the statistics include all {stats.closed} closed.</p> : null}
        </div>
      ) : null}
      <p className="mt-2 text-[11px] text-muted">
        {data.disclaimer} As of {data.asOf.slice(0, 10)}.
      </p>
    </main>
  );
}
