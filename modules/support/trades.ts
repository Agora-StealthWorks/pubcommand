/**
 * Track-record answers for finance brands. Read live from Track Record, never copied in.
 * Rules: closed trades only; only portfolios the brand has made public; never a ranked or
 * "worst trades" list; at least one filter (ticker, publication or dates) so the agent
 * cannot dump the record; results ordered by close date, never by gain.
 */

export type TradeRow = {
  symbol: string;
  name: string;
  direction: string;
  status: string;
  entryDate: Date;
  entryPrice: number;
  exitDate: Date | null;
  exitPrice: number | null;
  portfolio: string;
  publication: string;
};

export type TradeQuery = { ticker?: string; publication?: string; from?: string; to?: string; q?: string };

export const MAX_TRADES = 10;

const RANKING = /\b(worst|best|biggest|largest|top|bottom|losers?|losing|winners?|winning|most\s+(money|lost)|rank(ed|ing)?)\b/i;

export type TradeCheck = { ok: true; filters: { ticker: string | null; publication: string | null; from: Date | null; to: Date | null } } | { ok: false; message: string };

function day(value: string | undefined): Date | null | "bad" {
  if (!value?.trim()) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return "bad";
  const d = new Date(`${value.trim()}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? "bad" : d;
}

export function checkTradeQuery(query: TradeQuery): TradeCheck {
  const text = [query.q, query.ticker, query.publication].filter(Boolean).join(" ");
  if (RANKING.test(text)) return { ok: false, message: "The track record can be looked up by ticker, publication or date, not ranked. Ask about a specific trade." };
  const ticker = query.ticker?.trim().toUpperCase().replace(/[^A-Z0-9.:-]/g, "").slice(0, 20) || null;
  const publication = query.publication?.trim().slice(0, 120) || null;
  const from = day(query.from);
  const to = day(query.to);
  if (from === "bad" || to === "bad") return { ok: false, message: "Dates must be YYYY-MM-DD." };
  if (!ticker && !publication && !from && !to) return { ok: false, message: "Give a ticker, a publication or a date range to look up." };
  return { ok: true, filters: { ticker, publication, from, to } };
}

export function closedResultPct(row: Pick<TradeRow, "direction" | "entryPrice" | "exitPrice">): number | null {
  if (row.exitPrice == null || !(row.entryPrice > 0)) return null;
  const raw = ((row.exitPrice - row.entryPrice) / row.entryPrice) * 100;
  return row.direction === "SHORT" ? -raw : raw;
}

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Closed rows only, filtered, newest close first, capped. Never sorted by result. */
export function selectTrades(rows: readonly TradeRow[], filters: Extract<TradeCheck, { ok: true }>["filters"]): TradeRow[] {
  const pub = filters.publication?.toLowerCase();
  return rows
    .filter((r) => r.status === "CLOSED" && r.exitDate && r.exitPrice != null)
    .filter((r) => !filters.ticker || r.symbol.toUpperCase() === filters.ticker)
    .filter((r) => !pub || r.publication.toLowerCase().includes(pub) || r.portfolio.toLowerCase().includes(pub))
    .filter((r) => !filters.from || (r.exitDate as Date) >= filters.from)
    .filter((r) => !filters.to || (r.exitDate as Date) <= filters.to)
    .sort((a, b) => (b.exitDate as Date).getTime() - (a.exitDate as Date).getTime() || a.symbol.localeCompare(b.symbol))
    .slice(0, MAX_TRADES);
}

export function tradeAnswer(rows: readonly TradeRow[]) {
  return rows.map((r) => {
    const pct = closedResultPct(r);
    return {
      ticker: r.symbol,
      name: r.name || null,
      direction: r.direction === "SHORT" ? "short" : "long",
      publication: r.publication || r.portfolio,
      opened: iso(r.entryDate),
      closed: iso(r.exitDate),
      result: pct == null ? null : `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`,
    };
  });
}
