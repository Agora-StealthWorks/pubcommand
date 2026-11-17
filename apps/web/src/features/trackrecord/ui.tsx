import { Badge } from "@pubcommand/ui";
import Link from "next/link";
import { TableScroll } from "@/components/table-scroll";
import { formatPct, formatPrice, type Gain } from "../../../../../modules/performance/gain";
import { ASSET_LABELS, type AssetType } from "../../../../../modules/performance/positions";
import type { PortfolioStats, PublicTrackRecord } from "../../../../../modules/performance/stats";
import type { PositionView } from "./server";

export const iso = (date: Date | null | undefined) => (date ? date.toISOString().slice(0, 10) : "—");

export function GainText({ pct, className = "" }: { pct: number | null; className?: string }) {
  const tone = pct == null ? "text-muted" : pct > 0 ? "text-[#067647]" : pct < 0 ? "text-[#b42318]" : "text-ink";
  return <span className={`font-semibold tabular-nums ${tone} ${className}`}>{formatPct(pct)}</span>;
}

const SOURCE_LABEL: Record<Gain["source"], string> = {
  live: "Latest quote",
  stale: "Last stored quote",
  recorded: "Recorded price",
  peak: "Peak",
  exit: "Exit",
  none: "No gain",
  missing: "No price",
};

/** Why a price is what it is. Every stale or recorded figure is flagged with an asterisk and a reason. */
export function PriceNote({ gain }: { gain: Gain }) {
  if (gain.source === "exit") return null;
  return (
    <span className="block text-xs text-muted">
      {gain.stale ? <span className="font-semibold text-[#b54708]">* </span> : null}
      {SOURCE_LABEL[gain.source]}
      {gain.currentAt ? ` · ${iso(gain.currentAt)}` : ""}
    </span>
  );
}

export function MarketBanner({ connected, staleCount }: { connected: boolean; staleCount: number }) {
  if (!connected) {
    return (
      <p className="mb-4 rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
        Market data is not connected, so gains use the last stored prices (marked *). Add <code>MASSIVE_API_KEY</code> or <code>TIINGO_API_KEY</code> to get
        live prices, peaks and split detection. Closed positions are frozen at exit and are always exact.
      </p>
    );
  }
  if (staleCount > 0) {
    return (
      <p className="mb-4 rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
        {staleCount} open position{staleCount === 1 ? "" : "s"} could not be priced just now and show the last stored price (marked *).
      </p>
    );
  }
  return null;
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-white p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold tabular-nums">{value}</p>
      {hint ? <p className="truncate text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

const rate = (value: number | null) => (value == null ? "—" : `${Math.round(value * 100)}%`);
const days = (value: number | null) => (value == null ? "—" : `${Math.round(value)} days`);

/** Internal stats: shows everything, losers and the worst trade included. */
export function StatsGrid({ stats }: { stats: PortfolioStats }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <Stat label="Win rate" value={rate(stats.winRate)} hint={`${stats.winners} of ${stats.closed} closed`} />
      <Stat label="Average gain" value={<GainText pct={stats.avgGain} />} hint={`Weighted ${formatPct(stats.weightedAvgGain)}`} />
      <Stat label="Median gain" value={<GainText pct={stats.medianGain} />} hint={`${stats.losers} closed at a loss`} />
      <Stat label="Best" value={<GainText pct={stats.best?.gainPct ?? null} />} hint={stats.best?.symbol ?? "—"} />
      <Stat label="Worst" value={<GainText pct={stats.worst?.gainPct ?? null} />} hint={stats.worst?.symbol ?? "—"} />
      <Stat label="Avg hold" value={days(stats.avgHoldDays)} hint={`${stats.open} open · avg ${formatPct(stats.avgOpenGain)}`} />
    </div>
  );
}

function DirectionBadge({ direction }: { direction: string }) {
  return <Badge tone={direction === "SHORT" ? "warn" : "neutral"} className="whitespace-nowrap">{direction === "SHORT" ? "Short" : "Long"}</Badge>;
}

function describeInstrument(view: PositionView): string {
  if (view.assetType === "OPTION") return `${view.optionRight === "PUT" ? "Put" : "Call"} ${formatPrice(view.strike)} exp ${iso(view.expiry)}`;
  return ASSET_LABELS[(view.assetType as AssetType) ?? "STOCK"] ?? view.assetType;
}

export function PositionTable({ rows, portfolioId, kind, canWrite }: { rows: PositionView[]; portfolioId: string; kind: "open" | "closed"; canWrite: boolean }) {
  if (!rows.length) {
    return <p className="rounded-xl border border-line bg-white p-4 text-sm text-muted">{kind === "open" ? "No open positions." : "No closed positions yet."}</p>;
  }
  return (
    <TableScroll>
      <table className="w-full min-w-[52rem] border-collapse text-sm">
        <thead className="bg-canvas text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-3 py-2">Symbol</th>
            <th className="px-3 py-2">Side</th>
            <th className="px-3 py-2">Entry</th>
            {kind === "open" ? <th className="px-3 py-2">Stop / target</th> : <th className="px-3 py-2">Exit</th>}
            <th className="px-3 py-2">{kind === "open" ? "Current" : "Peak"}</th>
            <th className="px-3 py-2 text-right">Gain</th>
            <th className="px-3 py-2 text-right">Days</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((view) => (
            <tr key={view.id} className="border-t border-line align-top">
              <td className="px-3 py-2">
                {canWrite ? (
                  <Link href={`/performance/${portfolioId}/positions/${view.id}`} className="font-semibold text-accent">
                    {view.symbol}
                  </Link>
                ) : (
                  <span className="font-semibold">{view.symbol}</span>
                )}
                <span className="block max-w-[14rem] truncate text-xs text-muted">{view.name || describeInstrument(view)}</span>
                {view.gain.splitNote ? <span className="block text-xs text-muted">{view.gain.splitNote}</span> : null}
                {view.splitSource === "unknown" ? <span className="block text-xs text-[#b54708]">Entry price does not match the market on that date. Check it or set the split.</span> : null}
              </td>
              <td className="px-3 py-2">
                <DirectionBadge direction={view.direction} />
              </td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                {formatPrice(view.entryPrice)}
                <span className="block text-xs text-muted">{iso(view.entryDate)}</span>
              </td>
              {kind === "open" ? (
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                  {formatPrice(view.stopPrice)} / {formatPrice(view.targetPrice)}
                </td>
              ) : (
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                  {formatPrice(view.exitPrice)}
                  <span className="block text-xs text-muted">{iso(view.exitDate)}</span>
                </td>
              )}
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                {kind === "open" ? (
                  <>
                    {view.gain.stale ? "* " : ""}
                    {formatPrice(view.gain.current)}
                    <PriceNote gain={view.gain} />
                  </>
                ) : (
                  <>
                    {formatPrice(view.gain.peak?.price)}
                    <span className="block text-xs text-muted">{view.gain.peak ? `${formatPct(view.gain.peak.pct)} at best` : "Not checked yet"}</span>
                  </>
                )}
              </td>
              <td className="px-3 py-2 text-right">
                <GainText pct={view.gain.pct} />
                {kind === "open" && view.gain.peak ? <span className="block text-xs text-muted">peak {formatPct(view.gain.peak.pct)}</span> : null}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{view.days}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

/** The public-safe view. It only ever receives a PublicTrackRecord, which has no loser count or worst trade. */
export function PublicTrackRecordView({ record, title, subtitle, asOf }: { record: PublicTrackRecord; title: string; subtitle: string; asOf: Date }) {
  const { stats } = record;
  return (
    <div className="space-y-4">
      <header className="rounded-xl border border-line bg-white p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{subtitle}</p>
        <h1 className="mt-1 break-words text-2xl font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-muted">
          {record.includesOpen ? "Closed and open recommendations" : "Closed recommendations"}, as of {iso(asOf)}.
        </p>
      </header>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Closed" value={stats.closed} />
        <Stat label="Win rate" value={rate(stats.winRate)} />
        <Stat label="Average gain" value={<GainText pct={stats.avgGain} />} />
        <Stat label="Avg hold" value={days(stats.avgHoldDays)} />
      </div>
      {stats.best ? (
        <p className="rounded-xl border border-line bg-white p-4 text-sm">
          Best closed recommendation: <strong>{stats.best.symbol}</strong> <GainText pct={stats.best.gainPct} />
          {stats.best.holdDays != null ? ` in ${stats.best.holdDays} days` : ""}.
        </p>
      ) : null}
      <TableScroll>
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <thead className="bg-canvas text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2">Symbol</th>
              <th className="px-3 py-2">Side</th>
              <th className="px-3 py-2">Entry</th>
              <th className="px-3 py-2">Exit</th>
              <th className="px-3 py-2 text-right">Gain</th>
              <th className="px-3 py-2 text-right">Days</th>
            </tr>
          </thead>
          <tbody>
            {record.trades.map((trade, index) => (
              <tr key={`${trade.symbol}-${trade.entryDate}-${index}`} className="border-t border-line">
                <td className="px-3 py-2">
                  <span className="font-semibold">{trade.symbol}</span>
                  {trade.name ? <span className="block max-w-[14rem] truncate text-xs text-muted">{trade.name}</span> : null}
                </td>
                <td className="px-3 py-2">{trade.direction === "SHORT" ? "Short" : "Long"}</td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                  {formatPrice(trade.entryPrice)}
                  <span className="block text-xs text-muted">{trade.entryDate}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                  {trade.status === "OPEN" ? "Open" : formatPrice(trade.exitPrice)}
                  {trade.exitDate ? <span className="block text-xs text-muted">{trade.exitDate}</span> : null}
                </td>
                <td className="px-3 py-2 text-right">
                  <GainText pct={trade.gainPct} />
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{trade.holdDays ?? "—"}</td>
              </tr>
            ))}
            {record.trades.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted">
                  No closed recommendations yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </TableScroll>
      <p className="text-xs text-muted">
        Gains are calculated from the published entry and exit prices, adjusted for stock splits. Statistics include every closed recommendation. Past
        performance does not guarantee future results.
      </p>
    </div>
  );
}
