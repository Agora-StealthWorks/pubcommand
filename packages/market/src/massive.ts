/**
 * Massive (Polygon-compatible REST). Aggregates: /v2/aggs/ticker/{t}/range/{n}/{unit}/{from}/{to}.
 * Plan limits (checked by the old app against a live key): daily history reaches back about 10 years,
 * indices (I:SPX) are not entitled, hourly and 5-minute bars are. `limit` counts the underlying minute
 * bars, so intraday queries span several pages: always follow `next_url`.
 */
import { addDays, addYears, isoDate, utcDay } from "./dates";
import { failure, get } from "./http";
import { MarketError, type Bar, type FetchLike, type IntradayInterval } from "./types";

export const MASSIVE_HISTORY_YEARS = 10;
const MAX_PAGES = 40;

export interface MassiveOptions {
  apiKey: string;
  baseUrl?: string;
  fetch: FetchLike;
  timeoutMs?: number;
}

type RawAgg = { t: number; o: number; h: number; l: number; c: number; v?: number };

/** First day the plan serves, with a week of slack for the rolling window. */
export function massiveEarliest(today: string): string {
  return addDays(addYears(today, -MASSIVE_HISTORY_YEARS), 7);
}

function withKey(url: string, key: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}apiKey=${encodeURIComponent(key)}`;
}

export function createMassive(options: MassiveOptions) {
  const base = (options.baseUrl ?? "https://api.massive.com").replace(/\/+$/, "");

  async function pages(path: string, label: string): Promise<RawAgg[]> {
    const out: RawAgg[] = [];
    let url: string | null = withKey(`${base}${path}`, options.apiKey);
    for (let page = 0; url && page < MAX_PAGES; page += 1) {
      const response = await get(options.fetch, url, "Massive", undefined, options.timeoutMs);
      if (!response.ok) throw await failure("Massive", response.status, await response.text(), label);
      const data = (await response.json()) as { results?: RawAgg[]; next_url?: string };
      out.push(...(data.results ?? []));
      url = data.next_url ? withKey(data.next_url, options.apiKey) : null;
    }
    return out;
  }

  const clean = (rows: RawAgg[]) => rows.filter((row) => row && row.c > 0 && Number.isFinite(row.t));

  return {
    async daily(ticker: string, from: string, to: string): Promise<Bar[]> {
      const path = `/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=50000`;
      return clean(await pages(path, ticker)).map((row) => ({ t: utcDay(row.t), o: row.o, h: row.h, l: row.l, c: row.c, v: row.v }));
    },

    async intraday(ticker: string, from: string, to: string, interval: IntradayInterval, extended: boolean): Promise<Bar[]> {
      const [n, unit] = interval === "hour" ? [1, "hour"] : [5, "minute"];
      const path = `/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/${n}/${unit}/${from}/${to}?adjusted=true&sort=asc&limit=50000`;
      return clean(await pages(path, `${interval} ${ticker}`))
        .filter((row) => inSession(row.t, interval, extended))
        .map((row) => ({ t: row.t, o: row.o, h: row.h, l: row.l, c: row.c, v: row.v }));
    },

    /** Previous session close: /v2/aggs/ticker/{t}/prev. */
    async previousClose(ticker: string): Promise<{ price: number; at: number }> {
      const rows = await pages(`/v2/aggs/ticker/${encodeURIComponent(ticker)}/prev?adjusted=true`, ticker);
      const row = rows.at(-1);
      if (!row || !(row.c > 0)) throw new MarketError("not_found", `Massive has no recent price for ${ticker}.`);
      return { price: row.c, at: row.t };
    },

    async name(ticker: string): Promise<string | null> {
      try {
        const response = await get(options.fetch, withKey(`${base}/v3/reference/tickers/${encodeURIComponent(ticker)}`, options.apiKey), "Massive", undefined, 8000);
        if (!response.ok) return null;
        const data = (await response.json()) as { results?: { name?: string } };
        return data.results?.name ?? null;
      } catch {
        return null;
      }
    },
  };
}

const ET = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hourCycle: "h23" });

/** Regular session only unless `extended`. Hourly bars stamped 9:00 carry the 9:30 open. */
export function inSession(t: number, interval: IntradayInterval, extended: boolean): boolean {
  const [hour = 0, minute = 0] = ET.format(t).split(":").map(Number);
  const minutes = hour * 60 + minute;
  if (extended) return minutes >= 4 * 60 && minutes < 20 * 60;
  if (interval === "hour") return hour >= 9 && hour <= 15;
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

export { isoDate };
