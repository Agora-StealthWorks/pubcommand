/** One price bar. `t` is UTC milliseconds (daily bars: midnight UTC of the trading day). */
export interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
}

export type Adjust = "split" | "total";
export type Interval = "day" | "week" | "month";
export type IntradayInterval = "hour" | "5min";

export interface Series {
  /** What the caller asked for, normalised (upper case, trimmed). */
  symbol: string;
  /** What was actually fetched (SPY for SPX, the pair for a ratio). */
  resolved: string;
  name: string;
  bars: Bar[];
  /** "Massive", "Tiingo", "FRED", "Massive + Tiingo", "Uploaded data". */
  source: string;
  /** "$" for prices, "" for ratios and macro series. */
  unit: "$" | "";
  adjust: Adjust;
  warnings: string[];
}

export interface Quote {
  symbol: string;
  price: number;
  /** UTC ms of the price. */
  at: number;
  source: string;
  warnings: string[];
}

export type MarketErrorCode = "unconfigured" | "unavailable" | "not_entitled" | "not_found" | "bad_request";

export class MarketError extends Error {
  readonly code: MarketErrorCode;
  constructor(code: MarketErrorCode, message: string) {
    super(message);
    this.name = "MarketError";
    this.code = code;
  }
}

/** Response cache. Values are JSON. Implement over Postgres, Redis or memory. */
export interface MarketCache {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown, ttlMs: number): Promise<void>;
}

export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

/** One symbol-search result. `symbol` is what to type into a chart (crypto as BTC-USD). */
export interface SymbolHit {
  symbol: string;
  name: string;
  kind: "stock" | "etf" | "crypto" | "index" | "fred" | "other";
  exchange: string;
  source: string;
}
