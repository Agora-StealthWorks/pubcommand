import { addDays, isIsoDate, isoDate } from "./dates";
import { fredSeries } from "./fred";
import { defaultFetch } from "./http";
import { createMassive, massiveEarliest } from "./massive";
import { ratioBars, resample } from "./resample";
import { createTiingo } from "./tiingo";
import { MarketError, type Adjust, type Bar, type FetchLike, type Interval, type IntradayInterval, type MarketCache, type Quote, type Series } from "./types";

/** Index symbols the Massive plan cannot serve → the ETF that tracks each one. */
export const INDEX_ALIASES: Record<string, { ticker: string; name: string }> = {
  SPX: { ticker: "SPY", name: "S&P 500" },
  "^GSPC": { ticker: "SPY", name: "S&P 500" },
  "I:SPX": { ticker: "SPY", name: "S&P 500" },
  "S&P500": { ticker: "SPY", name: "S&P 500" },
  NDX: { ticker: "QQQ", name: "Nasdaq-100" },
  "^NDX": { ticker: "QQQ", name: "Nasdaq-100" },
  "I:NDX": { ticker: "QQQ", name: "Nasdaq-100" },
  DJI: { ticker: "DIA", name: "Dow Jones Industrial Average" },
  "^DJI": { ticker: "DIA", name: "Dow Jones Industrial Average" },
  "I:DJI": { ticker: "DIA", name: "Dow Jones Industrial Average" },
  RUT: { ticker: "IWM", name: "Russell 2000" },
  "^RUT": { ticker: "IWM", name: "Russell 2000" },
  "I:RUT": { ticker: "IWM", name: "Russell 2000" },
};

export const HOURLY_MAX_DAYS = 370;
export const FIVE_MIN_MAX_DAYS = 31;

export interface MarketOptions {
  massiveKey?: string | null;
  massiveBaseUrl?: string;
  tiingoKey?: string | null;
  fetch?: FetchLike;
  cache?: MarketCache;
  /** Today's date (UTC ISO). Injected for tests. */
  today?: () => string;
}

export interface DailyOptions {
  adjust?: Adjust;
  interval?: Interval;
}

export type SymbolKind = "fred" | "ratio" | "ticker";

/** What kind of symbol this is. Exposed so UIs can explain routing. */
export function classifySymbol(raw: string): { kind: SymbolKind; parts: string[] } {
  const symbol = raw.trim();
  if (/^FRED:/i.test(symbol)) return { kind: "fred", parts: [symbol.slice(5).trim()] };
  const parts = symbol.split("/").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 2) return { kind: "ratio", parts };
  return { kind: "ticker", parts: [symbol.toUpperCase()] };
}

/** Which provider is tried first for a ticker. Pure, so it is unit tested. */
export function planTickerRoute(input: { from: string; today: string; adjust: Adjust; massive: boolean; tiingo: boolean }): Array<"massive" | "tiingo"> {
  const tooOld = input.from < massiveEarliest(input.today);
  const order: Array<"massive" | "tiingo"> = input.adjust === "total" || tooOld ? ["tiingo", "massive"] : ["massive", "tiingo"];
  // Massive has no dividend-adjusted series, so total return never falls back to it.
  return order.filter((provider) => (provider === "massive" ? input.massive && input.adjust !== "total" : input.tiingo));
}

/** "Advanced Micro Devices, Inc." → "Advanced Micro Devices". */
export function cleanCompanyName(name: string): string {
  const suffix = /,?\s+(Inc|Corp|Corporation|Co|Ltd|Limited|plc|LLC|L\.?P|N\.?V|S\.?A|AG|SE|Class [A-C]|Common Stock|Ordinary Shares|American Depositary Shares|ADS|ADR|Shares|Stock)\.?$/i;
  let out = name.trim();
  for (let i = 0; i < 6; i += 1) {
    const next = out.replace(suffix, "").trim();
    if (next === out || !next) break;
    out = next;
  }
  return out;
}

const TICKER = /^[A-Z0-9.\-^:=&]{1,20}$/;

export function createMarket(options: MarketOptions = {}) {
  const fetcher = options.fetch ?? defaultFetch;
  const today = options.today ?? (() => isoDate(Date.now()));
  const massive = options.massiveKey ? createMassive({ apiKey: options.massiveKey, baseUrl: options.massiveBaseUrl, fetch: fetcher }) : null;
  const tiingo = options.tiingoKey ? createTiingo({ apiKey: options.tiingoKey, fetch: fetcher, today }) : null;

  /** Historical ranges barely change; anything touching the last few days refreshes hourly. */
  function ttlFor(to: string): number {
    return to >= addDays(today(), -3) ? 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  }

  async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    if (options.cache) {
      try {
        const hit = await options.cache.get(key);
        if (hit != null) return hit as T;
      } catch {
        // A cache problem never blocks data.
      }
    }
    const value = await load();
    if (options.cache) {
      try {
        await options.cache.set(key, value, ttlMs);
      } catch {
        // ignore
      }
    }
    return value;
  }

  function checkRange(from: string, to: string) {
    if (!isIsoDate(from) || !isIsoDate(to)) throw new MarketError("bad_request", "Dates must be YYYY-MM-DD.");
    if (from > to) throw new MarketError("bad_request", "The start date is after the end date.");
  }

  function alias(symbol: string, warnings: string[]): { ticker: string; name: string | null } {
    const hit = INDEX_ALIASES[symbol];
    if (!hit) return { ticker: symbol, name: null };
    warnings.push(`${symbol} index data is not on our data plan, so this charts ${hit.ticker}, the ETF that tracks it.`);
    return { ticker: hit.ticker, name: hit.name };
  }

  async function companyName(ticker: string): Promise<string> {
    return cached(`name:${ticker}`, 30 * 24 * 60 * 60 * 1000, async () => {
      const name = (massive ? await massive.name(ticker) : null) ?? (tiingo ? await tiingo.name(ticker) : null);
      return name ? cleanCompanyName(name) : ticker;
    });
  }

  async function tickerDaily(rawSymbol: string, from: string, to: string, adjust: Adjust): Promise<Series> {
    const symbol = rawSymbol.trim().toUpperCase();
    if (!TICKER.test(symbol)) throw new MarketError("bad_request", `"${rawSymbol}" is not a ticker.`);
    const warnings: string[] = [];
    const { ticker, name: aliasName } = alias(symbol, warnings);
    if (!massive && !tiingo) {
      throw new MarketError("unconfigured", "Market data is not connected. Set MASSIVE_API_KEY or TIINGO_API_KEY, or paste CSV data.");
    }
    if (adjust === "total" && !tiingo) {
      throw new MarketError("unconfigured", "Dividend-adjusted prices need TIINGO_API_KEY.");
    }
    const route = planTickerRoute({ from, today: today(), adjust, massive: !!massive, tiingo: !!tiingo });
    const errors: MarketError[] = [];
    let bars: Bar[] | null = null;
    let source = "";
    for (const provider of route) {
      try {
        const loaded =
          provider === "massive" && massive
            ? await cached(`massive:day:${ticker}:${from}:${to}`, ttlFor(to), () => massive.daily(ticker, from, to))
            : tiingo
              ? await cached(`tiingo:day:${ticker}:${from}:${to}:${adjust}`, ttlFor(to), () => tiingo.daily(ticker, from, to, adjust))
              : [];
        if (loaded.length >= 2) {
          bars = loaded;
          source = provider === "massive" ? "Massive" : "Tiingo";
          break;
        }
        errors.push(new MarketError("not_found", `${provider === "massive" ? "Massive" : "Tiingo"} has no data for ${ticker} in that range.`));
      } catch (error) {
        errors.push(error instanceof MarketError ? error : new MarketError("unavailable", String(error)));
      }
    }
    if (!bars) {
      const best = errors.find((error) => error.code === "not_found") ?? errors[0];
      throw new MarketError(best?.code ?? "not_found", errors.map((error) => error.message).join(" ") || `No price data for ${ticker}.`);
    }
    if (source === "Massive" && from < massiveEarliest(today())) {
      warnings.push(`Massive only reaches back to ${massiveEarliest(today())}; the chart starts there.`);
    }
    if (source === "Tiingo" && route[0] === "massive") warnings.push(`Massive failed (${errors[0]?.message ?? "no data"}), so this uses Tiingo.`);
    if (adjust === "total") warnings.push("Prices include reinvested dividends (total return).");
    return {
      symbol,
      resolved: ticker,
      name: aliasName ?? (await companyName(ticker)),
      bars,
      source,
      unit: "$",
      adjust,
      warnings,
    };
  }

  async function one(symbol: string, from: string, to: string, adjust: Adjust): Promise<Series> {
    const route = classifySymbol(symbol);
    if (route.kind === "fred") {
      const id = route.parts[0] as string;
      const bars = await cached(`fred:${id}:${from}:${to}`, ttlFor(to), () => fredSeries(fetcher, id, from, to));
      if (bars.length < 2) throw new MarketError("not_found", `FRED has no observations for ${id} in that range.`);
      return { symbol: `FRED:${id}`, resolved: id, name: id, bars, source: "FRED", unit: "", adjust: "split", warnings: [] };
    }
    return tickerDaily(symbol, from, to, adjust);
  }

  return {
    /** Daily bars (optionally resampled to week/month) for a ticker, `FRED:<id>`, or `A/B` ratio. */
    async dailyBars(symbol: string, from: string, to: string, opts: DailyOptions = {}): Promise<Series> {
      checkRange(from, to);
      const adjust = opts.adjust ?? "split";
      const interval = opts.interval ?? "day";
      const route = classifySymbol(symbol);
      let series: Series;
      if (route.kind === "ratio") {
        const [a, b] = await Promise.all(route.parts.map((part) => one(part, from, to, adjust)));
        if (!a || !b) throw new MarketError("bad_request", "A ratio needs two symbols, like CPER/GLD.");
        const bars = ratioBars(a.bars, b.bars);
        if (bars.length < 2) throw new MarketError("not_found", `${a.symbol} and ${b.symbol} have no dates in common.`);
        series = {
          symbol: `${a.symbol}/${b.symbol}`,
          resolved: `${a.resolved}/${b.resolved}`,
          name: `${a.name} to ${b.name} ratio`,
          bars,
          source: a.source === b.source ? a.source : `${a.source} + ${b.source}`,
          unit: "",
          adjust,
          warnings: [...a.warnings, ...b.warnings],
        };
      } else {
        series = await one(symbol, from, to, adjust);
      }
      return { ...series, bars: resample(series.bars, interval) };
    },

    /** Hourly (up to ~1 year) or 5-minute (up to ~1 month) bars from Massive, New York session hours. */
    async intradayBars(symbol: string, from: string, to: string, opts: { interval: IntradayInterval; extended?: boolean }): Promise<Series> {
      checkRange(from, to);
      const route = classifySymbol(symbol);
      if (route.kind !== "ticker") throw new MarketError("bad_request", "Intraday charts work for single tickers only.");
      const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
      const max = opts.interval === "hour" ? HOURLY_MAX_DAYS : FIVE_MIN_MAX_DAYS;
      if (days > max) throw new MarketError("bad_request", opts.interval === "hour" ? "Hourly charts go up to 1 year." : "5-minute charts go up to 1 month.");
      if (!massive) throw new MarketError("unconfigured", "Intraday charts need MASSIVE_API_KEY.");
      const symbolUpper = route.parts[0] as string;
      const warnings: string[] = [];
      const { ticker, name: aliasName } = alias(symbolUpper, warnings);
      const extended = !!opts.extended;
      const bars = await cached(`massive:${opts.interval}:${ticker}:${from}:${to}:${extended ? "x" : "r"}`, 15 * 60 * 1000, () =>
        massive.intraday(ticker, from, to, opts.interval, extended),
      );
      if (bars.length < 2) throw new MarketError("not_found", `No ${opts.interval} data for ${ticker} in that range.`);
      warnings.push(`${opts.interval === "hour" ? "Hourly" : "5-minute"} bars, ${extended ? "including pre-market and after-hours" : "regular trading hours"} (New York time).`);
      return { symbol: symbolUpper, resolved: ticker, name: aliasName ?? (await companyName(ticker)), bars, source: "Massive", unit: "$", adjust: "split", warnings };
    },

    /** Latest available price (previous close on Massive, last EOD on Tiingo). */
    async quote(symbol: string): Promise<Quote> {
      const route = classifySymbol(symbol);
      if (route.kind !== "ticker") throw new MarketError("bad_request", "Quotes work for single tickers only.");
      const warnings: string[] = [];
      const { ticker } = alias(route.parts[0] as string, warnings);
      if (!massive && !tiingo) throw new MarketError("unconfigured", "Market data is not connected. Set MASSIVE_API_KEY or TIINGO_API_KEY.");
      const errors: string[] = [];
      for (const provider of [massive ? "massive" : null, tiingo ? "tiingo" : null]) {
        try {
          if (provider === "massive" && massive) {
            const hit = await cached(`massive:quote:${ticker}`, 10 * 60 * 1000, () => massive.previousClose(ticker));
            return { symbol: ticker, price: hit.price, at: hit.at, source: "Massive", warnings };
          }
          if (provider === "tiingo" && tiingo) {
            const hit = await cached(`tiingo:quote:${ticker}`, 10 * 60 * 1000, () => tiingo.latest(ticker));
            return { symbol: ticker, price: hit.price, at: hit.at, source: "Tiingo", warnings };
          }
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
      throw new MarketError("unavailable", errors.join(" ") || `No price for ${ticker}.`);
    },

    configured: { massive: !!massive, tiingo: !!tiingo, fred: true },
  };
}

export type Market = ReturnType<typeof createMarket>;

/** In-memory cache for tests and scripts. */
export function memoryCache(): MarketCache & { size(): number } {
  const store = new Map<string, { value: unknown; expires: number }>();
  return {
    async get(key) {
      const hit = store.get(key);
      if (!hit || hit.expires < Date.now()) return null;
      return hit.value;
    },
    async set(key, value, ttlMs) {
      store.set(key, { value, expires: Date.now() + ttlMs });
    },
    size: () => store.size,
  };
}
