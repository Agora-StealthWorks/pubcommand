import { MarketError, createMarket, isoDate, parseBarsCsv, periodRange, resample, type Bar, type MarketCache, type Series } from "@pubcommand/market";
import { rawPrisma, type Prisma } from "@pubcommand/db";
import type { DataSpec } from "../../../../../modules/charts/spec";

/** Postgres-backed cache for market responses (public prices; shared by every tenant). */
const pgCache: MarketCache = {
  async get(key) {
    const row = await rawPrisma().marketCache.findUnique({ where: { key } });
    if (!row || row.expiresAt.getTime() < Date.now()) return null;
    return row.value;
  },
  async set(key, value, ttlMs) {
    const expiresAt = new Date(Date.now() + ttlMs);
    const json = value as Prisma.InputJsonValue;
    await rawPrisma().marketCache.upsert({ where: { key }, create: { key, value: json, expiresAt }, update: { value: json, expiresAt } });
    if (Math.random() < 0.02) await rawPrisma().marketCache.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  },
};

export function market() {
  return createMarket({
    massiveKey: process.env.MASSIVE_API_KEY || null,
    massiveBaseUrl: process.env.MASSIVE_BASE_URL || undefined,
    tiingoKey: process.env.TIINGO_API_KEY || null,
    cache: pgCache,
  });
}

export function marketStatus() {
  return { massive: Boolean(process.env.MASSIVE_API_KEY), tiingo: Boolean(process.env.TIINGO_API_KEY) };
}

export function todayIso(): string {
  return isoDate(Date.now());
}

export type LoadedSeries = {
  symbol: string;
  name: string;
  source: string;
  unit: "$" | "";
  warnings: string[];
  from: string;
  to: string;
  bars: Bar[];
};

export type SeriesResult = { ok: true; series: LoadedSeries } | { ok: false; error: string; code: string };

/** The dates a DataSpec covers (period chips resolve against today). */
export function rangeOf(data: Pick<DataSpec, "period" | "from" | "to">, today = todayIso()): { from: string; to: string } {
  if (data.period === "CUSTOM") return { from: data.from, to: data.to };
  return periodRange(data.period, today);
}

const MAX_BARS = 12_000;

/** Load the bars a chart draws. CSV comes from the spec itself; everything else from @pubcommand/market. */
export async function loadSeries(data: DataSpec): Promise<SeriesResult> {
  const { from, to } = rangeOf(data);
  try {
    if (data.symbol.trim().toUpperCase() === "CSV") {
      const parsed = parseBarsCsv(data.csv);
      const f = Date.parse(`${from}T00:00:00Z`);
      const t = Date.parse(`${to}T23:59:59Z`);
      const inRange = data.period === "MAX" ? parsed.bars : parsed.bars.filter((bar) => bar.t >= f && bar.t <= t);
      const bars = inRange.length >= 2 ? inRange : parsed.bars;
      const warnings = inRange.length >= 2 ? [] : ["The period does not match the pasted data, so the chart shows all of it."];
      if (parsed.skipped) warnings.push(`${parsed.skipped} row${parsed.skipped === 1 ? "" : "s"} without a date and number were skipped.`);
      const shaped = data.interval === "week" || data.interval === "month" ? resample(bars, data.interval) : bars;
      return {
        ok: true,
        series: { symbol: parsed.valueLabel.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) || "DATA", name: parsed.valueLabel.replace(/^./, (c) => c.toUpperCase()), source: "Uploaded data", unit: "", warnings, from: isoDate(shaped[0]!.t), to: isoDate(shaped.at(-1)!.t), bars: shaped.slice(-MAX_BARS) },
      };
    }
    const m = market();
    let series: Series;
    if (data.interval === "hour" || data.interval === "5min") {
      series = await m.intradayBars(data.symbol, from, to, { interval: data.interval });
    } else {
      series = await m.dailyBars(data.symbol, from, to, { adjust: data.adjust, interval: data.interval });
    }
    const bars = series.bars.slice(-MAX_BARS);
    const warnings = [...series.warnings];
    if (series.bars.length > MAX_BARS) warnings.push(`Showing the last ${MAX_BARS.toLocaleString("en-US")} bars; pick a longer timeframe for the full range.`);
    return { ok: true, series: { symbol: series.symbol, name: series.name, source: series.source, unit: series.unit, warnings, from, to, bars } };
  } catch (error) {
    if (error instanceof MarketError) return { ok: false, error: error.message, code: error.code };
    console.error("[charts] series failed", error);
    return { ok: false, error: "The market data request failed. Try again, or paste CSV data.", code: "unavailable" };
  }
}

/** Compact bars for storage: [[t, o, h, l, c], ...]. */
export function packBars(bars: readonly Bar[]): number[][] {
  return bars.map((bar) => [bar.t, bar.o, bar.h, bar.l, bar.c]);
}

export function unpackBars(value: unknown): Bar[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is number[] => Array.isArray(row) && row.length >= 5 && row.every((n) => typeof n === "number"))
    .map(([t, o, h, l, c]) => ({ t: t as number, o: o as number, h: h as number, l: l as number, c: c as number }));
}
