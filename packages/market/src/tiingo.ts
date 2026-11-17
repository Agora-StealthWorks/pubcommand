/**
 * Tiingo end-of-day prices: GET https://api.tiingo.com/tiingo/daily/{ticker}/prices?startDate&endDate,
 * header `Authorization: Token <key>`. Deep history (decades), with raw close and splitFactor per day.
 */
import { isoDate } from "./dates";
import { failure, get } from "./http";
import { MarketError, type Adjust, type Bar, type FetchLike, type SymbolHit } from "./types";

export interface TiingoRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  adjOpen: number;
  adjHigh: number;
  adjLow: number;
  adjClose: number;
  splitFactor?: number;
  divCash?: number;
}

/**
 * Split-only prices. Tiingo's adjClose also folds dividends in, which makes old prices lower than the
 * quote ever was and inflates a gain headline. Walk newest → oldest and divide each raw price by the
 * product of every split that happened AFTER that day. A split's factor applies to bars before its date.
 */
export function splitOnly(rows: readonly TiingoRow[]): Bar[] {
  const out: Bar[] = new Array(rows.length);
  let factor = 1;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index] as TiingoRow;
    const t = Date.parse(`${row.date.slice(0, 10)}T00:00:00Z`);
    out[index] = { t, o: row.open / factor, h: row.high / factor, l: row.low / factor, c: row.close / factor, v: row.volume };
    if (row.splitFactor && row.splitFactor !== 1) factor *= row.splitFactor;
  }
  return out;
}

export function totalReturn(rows: readonly TiingoRow[]): Bar[] {
  return rows.map((row) => ({
    t: Date.parse(`${row.date.slice(0, 10)}T00:00:00Z`),
    o: row.adjOpen,
    h: row.adjHigh,
    l: row.adjLow,
    c: row.adjClose,
    v: row.volume,
  }));
}

export function createTiingo(options: { apiKey: string; fetch: FetchLike; today: () => string; timeoutMs?: number }) {
  const headers = { Authorization: `Token ${options.apiKey}`, "Content-Type": "application/json" };
  // Tiingo spells share classes with a dash: BRK.B → BRK-B.
  const symbol = (ticker: string) => encodeURIComponent(ticker.replace(".", "-"));

  return {
    async daily(ticker: string, from: string, to: string, adjust: Adjust): Promise<Bar[]> {
      // Fetch through today even when the chart ends earlier: later splits still apply.
      const url = `https://api.tiingo.com/tiingo/daily/${symbol(ticker)}/prices?startDate=${from}&endDate=${options.today()}&format=json`;
      const response = await get(options.fetch, url, "Tiingo", headers, options.timeoutMs ?? 30_000);
      if (!response.ok) throw await failure("Tiingo", response.status, await response.text(), ticker);
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new MarketError("bad_request", "Tiingo returned an unexpected payload.");
      const end = Date.parse(`${to}T23:59:59Z`);
      const bars = adjust === "total" ? totalReturn(rows as TiingoRow[]) : splitOnly(rows as TiingoRow[]);
      return bars.filter((bar) => bar.c > 0 && bar.t <= end);
    },

    async latest(ticker: string): Promise<{ price: number; at: number }> {
      const url = `https://api.tiingo.com/tiingo/daily/${symbol(ticker)}/prices`;
      const response = await get(options.fetch, url, "Tiingo", headers, 10_000);
      if (!response.ok) throw await failure("Tiingo", response.status, await response.text(), ticker);
      const rows = (await response.json()) as TiingoRow[];
      const row = Array.isArray(rows) ? rows.at(-1) : undefined;
      if (!row || !(row.close > 0)) throw new MarketError("not_found", `Tiingo has no recent price for ${ticker}.`);
      return { price: row.close, at: Date.parse(`${row.date.slice(0, 10)}T00:00:00Z`) };
    },

    /** Crypto daily bars in USD: /tiingo/crypto/prices?tickers=btcusd&resampleFreq=1day. */
    async crypto(coin: string, from: string, to: string): Promise<Bar[]> {
      const pair = `${coin.toLowerCase()}usd`;
      const url = `https://api.tiingo.com/tiingo/crypto/prices?tickers=${encodeURIComponent(pair)}&startDate=${from}&endDate=${to}&resampleFreq=1day`;
      const response = await get(options.fetch, url, "Tiingo", headers, options.timeoutMs ?? 30_000);
      if (!response.ok) throw await failure("Tiingo", response.status, await response.text(), `${coin}-USD`);
      const data = (await response.json()) as Array<{ priceData?: Array<{ date: string; open: number; high: number; low: number; close: number; volume?: number }> }>;
      if (!Array.isArray(data)) throw new MarketError("bad_request", "Tiingo returned an unexpected payload.");
      const rows = data[0]?.priceData ?? [];
      return rows
        .map((row) => ({ t: Date.parse(`${row.date.slice(0, 10)}T00:00:00Z`), o: row.open, h: row.high, l: row.low, c: row.close, v: row.volume }))
        .filter((bar) => Number.isFinite(bar.t) && bar.c > 0);
    },

    /** Symbol search: /tiingo/utilities/search?query=. */
    async search(query: string): Promise<SymbolHit[]> {
      const url = `https://api.tiingo.com/tiingo/utilities/search?query=${encodeURIComponent(query)}&limit=20`;
      const response = await get(options.fetch, url, "Tiingo", headers, 8000);
      if (!response.ok) throw await failure("Tiingo", response.status, await response.text(), "symbol search");
      const rows = (await response.json()) as Array<{ ticker?: string; name?: string; assetType?: string; countryCode?: string; isActive?: boolean }>;
      if (!Array.isArray(rows)) return [];
      return rows
        .filter((row) => row.ticker && row.isActive !== false)
        .map((row) => {
          const type = (row.assetType ?? "").toLowerCase();
          const kind: SymbolHit["kind"] = type.includes("etf") || type.includes("fund") ? "etf" : type.includes("crypto") ? "crypto" : "stock";
          const ticker = String(row.ticker).toUpperCase();
          return { symbol: kind === "crypto" ? ticker.replace(/USD$/, "-USD") : ticker.replace("-", "."), name: row.name ?? ticker, kind, exchange: row.countryCode ?? "", source: "Tiingo" };
        });
    },

    async name(ticker: string): Promise<string | null> {
      try {
        const response = await get(options.fetch, `https://api.tiingo.com/tiingo/daily/${symbol(ticker)}`, "Tiingo", headers, 8000);
        if (!response.ok) return null;
        const data = (await response.json()) as { name?: string };
        return data.name ?? null;
      } catch {
        return null;
      }
    },
  };
}

export { isoDate };
