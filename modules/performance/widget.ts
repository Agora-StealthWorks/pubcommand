/**
 * The embeddable track-record widget (iframe and JSON). Pure.
 *
 * It is built only from a PublicTrackRecord (stats.ts), which cannot carry a loser count, the worst trade or a
 * list of losers, and it copies an explicit allow-list of fields on top of that, so a field added to positions
 * later can never leak into an embed. Closed trades only unless the portfolio's widget includes open ones.
 * Trades stay in date order (never sorted by gain) and the stats cover every closed trade.
 */
import type { PublicTrackRecord } from "./stats";

export const WIDGET_DEFAULT_LIMIT = 25;
export const WIDGET_MAX_LIMIT = 200;

export type WidgetView = "table" | "stats" | "both";

export type WidgetTrade = {
  symbol: string;
  name: string;
  direction: "LONG" | "SHORT";
  status: "OPEN" | "CLOSED";
  entryDate: string;
  exitDate: string | null;
  entryPrice: number;
  exitPrice: number | null;
  gainPct: number | null;
  holdDays: number | null;
};

export type WidgetPayload = {
  portfolio: string;
  publication: string;
  brand: string;
  asOf: string;
  includesOpen: boolean;
  stats: {
    closed: number;
    winRate: number | null;
    avgGain: number | null;
    avgHoldDays: number | null;
    best: { symbol: string; gainPct: number; holdDays: number | null } | null;
  };
  trades: WidgetTrade[];
  /** Trades left out by the limit (the stats still count them). */
  more: number;
  disclaimer: string;
};

export const WIDGET_DISCLAIMER =
  "Gains are calculated from the published entry and exit prices, adjusted for stock splits. Statistics include every closed recommendation. Past performance does not guarantee future results.";

export function widgetLimit(raw: string | null | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? Math.min(n, WIDGET_MAX_LIMIT) : WIDGET_DEFAULT_LIMIT;
}

export function widgetView(raw: string | null | undefined): WidgetView {
  return raw === "table" || raw === "stats" ? raw : "both";
}

const round = (value: number | null, digits = 2) => (value == null || !Number.isFinite(value) ? null : Number(value.toFixed(digits)));

export function widgetPayload(record: PublicTrackRecord, meta: { portfolio: string; publication: string; brand: string; asOf: Date; limit?: number }): WidgetPayload {
  const limit = Math.min(Math.max(1, meta.limit ?? WIDGET_DEFAULT_LIMIT), WIDGET_MAX_LIMIT);
  const trades = record.trades.filter((t) => t.status === "CLOSED" || record.includesOpen);
  return {
    portfolio: meta.portfolio,
    publication: meta.publication,
    brand: meta.brand,
    asOf: meta.asOf.toISOString(),
    includesOpen: record.includesOpen,
    stats: {
      closed: record.stats.closed,
      winRate: round(record.stats.winRate, 4),
      avgGain: round(record.stats.avgGain),
      avgHoldDays: round(record.stats.avgHoldDays, 0),
      best: record.stats.best ? { symbol: record.stats.best.symbol, gainPct: round(record.stats.best.gainPct) as number, holdDays: record.stats.best.holdDays } : null,
    },
    trades: trades.slice(0, limit).map((t) => ({
      symbol: t.symbol,
      name: t.name,
      direction: t.direction,
      status: t.status,
      entryDate: t.entryDate,
      exitDate: t.exitDate,
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice,
      gainPct: round(t.gainPct),
      holdDays: t.holdDays,
    })),
    more: Math.max(0, trades.length - limit),
    disclaimer: WIDGET_DISCLAIMER,
  };
}

/** The iframe snippet a person pastes into a page. */
export function embedSnippet(url: string, title: string): string {
  const safeTitle = title.replace(/[<>"&]/g, "");
  return `<iframe src="${url}" title="${safeTitle}" style="width:100%;border:0;min-height:480px" loading="lazy"></iframe>
<script>window.addEventListener("message",function(e){if(e.data&&e.data.type==="pubcommand-track-record:height"){document.querySelectorAll('iframe[src^="${url.split("?")[0]}"]').forEach(function(f){f.style.height=e.data.height+"px"})}});</script>`;
}
