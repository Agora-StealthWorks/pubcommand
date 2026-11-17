import { MarketError, isoDate } from "@pubcommand/market";
import { tenantDb } from "@pubcommand/db";
// The shared market wiring (Massive/Tiingo keys + the Postgres response cache) lives with ChartBuilder.
import { market, marketStatus } from "@/features/charts/market";
import { bestClose, inferSplitFactor, type Direction } from "../../../../../modules/performance/gain";

export const QUOTE_TTL_MS = 10 * 60 * 1000;
const PEAK_TTL_MS = 20 * 60 * 60 * 1000;

export type StoredQuote = { price: number; at: Date | null; stale: boolean; error: string | null; source: string };

export function marketConnected(): boolean {
  const status = marketStatus();
  return status.massive || status.tiingo;
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        out[index] = await fn(items[index] as T);
      }
    }),
  );
  return out;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new MarketError("unavailable", "The price request timed out.")), ms))]);
}

/**
 * Quotes for these symbols, market basis. Symbols not refreshed in the last 10 minutes are fetched (when a key is
 * set). A failed fetch keeps the last stored price and flags it stale; with no key every stored price is stale.
 */
export async function loadQuotes(organizationId: string, symbols: readonly string[], options: { refresh?: boolean; force?: boolean } = {}): Promise<Map<string, StoredQuote>> {
  const unique = [...new Set(symbols.filter(Boolean))];
  const db = tenantDb(organizationId);
  const rows = unique.length ? await db.trackQuote.findMany({ where: { symbol: { in: unique } } }) : [];
  const bySymbol = new Map(rows.map((row) => [row.symbol, row]));
  const connected = marketConnected();
  const refresh = options.refresh !== false && connected;
  if (refresh) {
    const due = unique.filter((symbol) => {
      const row = bySymbol.get(symbol);
      return options.force || !row || Date.now() - row.fetchedAt.getTime() > QUOTE_TTL_MS;
    });
    const m = market();
    await mapLimit(due, 5, async (symbol) => {
      let data: { price: number | null; asOf: Date | null; source: string; error: string | null };
      const previous = bySymbol.get(symbol);
      try {
        const quote = await withTimeout(m.quote(symbol), 8000);
        data = { price: quote.price, asOf: new Date(quote.at), source: quote.source, error: null };
      } catch (error) {
        const message = error instanceof MarketError ? error.message : "The price request failed.";
        data = { price: previous?.price ?? null, asOf: previous?.asOf ?? null, source: previous?.source ?? "", error: message.slice(0, 300) };
      }
      const fetchedAt = new Date();
      if (previous) {
        await db.trackQuote.updateMany({ where: { id: previous.id }, data: { ...data, fetchedAt } });
        bySymbol.set(symbol, { ...previous, ...data, fetchedAt });
      } else {
        try {
          const created = await db.trackQuote.create({ data: { organizationId, symbol, ...data, fetchedAt } });
          bySymbol.set(symbol, created);
        } catch {
          // A parallel request stored it first.
        }
      }
    });
  }
  const out = new Map<string, StoredQuote>();
  for (const [symbol, row] of bySymbol) {
    if (row.price == null) continue;
    out.set(symbol, { price: row.price, at: row.asOf, stale: !connected || row.error != null, error: row.error, source: row.source });
  }
  return out;
}

export type HistoryTarget = {
  priceSymbol: string;
  direction: Direction;
  entryDate: Date;
  entryPrice: number;
  /** Exit date for a closed trade; null = through today. */
  endDate: Date | null;
  splitSource: string;
  detectSplits: boolean;
};

export type HistoryResult =
  | { ok: true; peakPrice: number | null; peakDate: Date | null; split: { factor: number; source: "detected" | "none" | "unknown" } | null }
  | { ok: false; error: string };

/** Best close since entry and (unless a person set it) the split factor since entry, from daily split-only bars. */
export async function loadHistory(target: HistoryTarget): Promise<HistoryResult> {
  if (!marketConnected()) return { ok: false, error: "Market data is not connected." };
  const from = isoDate(target.entryDate.getTime());
  const to = isoDate((target.endDate ?? new Date()).getTime());
  if (from >= to) return { ok: true, peakPrice: null, peakDate: null, split: null };
  try {
    const series = await withTimeout(market().dailyBars(target.priceSymbol, from, to), 15000);
    const best = bestClose(target.direction, series.bars);
    let split: { factor: number; source: "detected" | "none" | "unknown" } | null = null;
    if (target.detectSplits && target.splitSource !== "manual") {
      const first = series.bars[0];
      const firstDay = first ? isoDate(first.t) : null;
      // Only trust the comparison when the market has a bar within a week of the entry date.
      if (first && firstDay && Date.parse(firstDay) - Date.parse(from) <= 7 * 86_400_000) {
        const factor = inferSplitFactor(target.entryPrice, first.c);
        split = factor == null ? { factor: 1, source: "unknown" } : { factor, source: factor === 1 ? "none" : "detected" };
      }
    }
    return { ok: true, peakPrice: best?.price ?? null, peakDate: best?.at ?? null, split };
  } catch (error) {
    return { ok: false, error: error instanceof MarketError ? error.message : "The price history request failed." };
  }
}

export function historyDue(checkedAt: Date | null, closed: boolean): boolean {
  if (!checkedAt) return true;
  if (closed) return false;
  return Date.now() - checkedAt.getTime() > PEAK_TTL_MS;
}
