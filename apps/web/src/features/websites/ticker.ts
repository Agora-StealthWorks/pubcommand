import { addDays, createMarket, isoDate, memoryCache, type Market } from "@pubcommand/market";
import { parseTickerSymbols, quoteFromBars } from "../../../../../modules/websites/content";

/**
 * The website's market ticker. Prices come from Massive (MASSIVE_API_KEY on PubCommand);
 * Site settings only chooses the symbols. Cached in memory for 5 minutes per symbol list,
 * so a busy site makes a handful of Massive calls an hour.
 */

export type TickerQuote = { label: string; symbol: string; price: number; change: number; changePct: number; asOf: string };

const TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; quotes: TickerQuote[] }>();
let market: Market | null = null;

function getMarket(): Market | null {
  const key = process.env.MASSIVE_API_KEY;
  if (!key) return null;
  market ??= createMarket({ massiveKey: key, massiveBaseUrl: process.env.MASSIVE_BASE_URL || undefined, cache: memoryCache() });
  return market;
}

export function tickerConfigured(): boolean {
  return Boolean(process.env.MASSIVE_API_KEY);
}

/** Quotes for the site's symbols. Symbols Massive cannot price are left out; never throws. */
export async function tickerQuotes(text: string, now = Date.now()): Promise<TickerQuote[]> {
  const symbols = parseTickerSymbols(text);
  const key = symbols.map((row) => `${row.label}|${row.symbol}`).join(";");
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.quotes;
  const source = getMarket();
  if (!source) return [];
  const today = isoDate(now);
  const from = addDays(today, -10);
  const quotes = (
    await Promise.all(
      symbols.map(async (row) => {
        try {
          const series = await source.dailyBars(row.symbol, from, today);
          const quote = quoteFromBars(series.bars);
          return quote ? { ...row, ...quote } : null;
        } catch (error) {
          console.warn(`[websites] ticker ${row.symbol}:`, error instanceof Error ? error.message : error);
          return null;
        }
      }),
    )
  ).filter((quote): quote is TickerQuote => quote !== null);
  // Keep a stale answer rather than an empty strip when Massive is briefly unavailable.
  if (quotes.length || !hit) cache.set(key, { at: now, quotes });
  return quotes.length ? quotes : (hit?.quotes ?? []);
}

/** "6,912.40" / "$121,440" style, compact for the strip. */
export function formatPrice(value: number, symbol: string): string {
  const crypto = symbol.startsWith("X:");
  return `${crypto || value >= 1 ? "$" : ""}${value.toLocaleString("en-US", { minimumFractionDigits: value >= 1000 ? 0 : 2, maximumFractionDigits: value >= 1000 ? 0 : 2 })}`;
}
