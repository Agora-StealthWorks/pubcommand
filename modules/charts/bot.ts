/**
 * The bot API's request body → ChartSpec. Pure. A bot sends either a full `spec`, or a short request
 * (ticker + template + a few fields) that is laid over the template the caller resolved. Every number
 * still comes from data: the bot can only write headline text, and tokens fill in the figures.
 */
import { BULK_MAX_ROWS } from "./bulk";
import {
  CHART_PERIODS,
  CHART_TYPES,
  COMPARE_MODES,
  INTERVALS,
  PERF_COLORS,
  SIZE_PRESETS,
  applyStyle,
  normalizeCompare,
  normalizeSpec,
  type ChartInterval,
  type ChartPeriod,
  type ChartSpec,
  type HeadlineOverlay,
  type SizePreset,
  type StyleSpec,
} from "./spec";
import { defaultSpec } from "./templates";

export type BotResult = { ok: true; spec: ChartSpec } | { ok: false; error: string; field: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const SIZE_ALIASES: Record<string, SizePreset> = { hd: "video", wide: "promo", link: "social", "16:9": "video", "1:1": "square", "4:5": "portrait", "9:16": "story" };

function o(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const PERIOD_YEARS: Record<string, number> = { "1M": 0.08, "3M": 0.25, "6M": 0.5, YTD: 1, "1Y": 1, "3Y": 3, "5Y": 5, "10Y": 10, "20Y": 20, MAX: 40 };

/** Daily up to 2 years, weekly up to 8, monthly beyond: long daily charts look like fuzz. */
export function autoInterval(period: ChartPeriod, from: string | null, to: string | null): ChartInterval {
  const years = period === "CUSTOM" && from && to ? (Date.parse(to) - Date.parse(from)) / (365.25 * 86_400_000) : (PERIOD_YEARS[period] ?? 1);
  return years <= 2 ? "day" : years <= 8 ? "week" : "month";
}

export function botSpec(body: unknown, style: StyleSpec | null, templateId: string | null, today: string): BotResult {
  const b = o(body);
  if (b.spec !== undefined) {
    const spec = normalizeSpec(b.spec, today);
    return { ok: true, spec };
  }
  const ticker = typeof b.ticker === "string" ? b.ticker.trim() : "";
  if (!ticker || ticker.length > 40 || !/^[A-Za-z0-9.\-^:=&/ ]+$/.test(ticker)) return { ok: false, error: "ticker is required: a symbol like AMD, BTC-USD, CPER/GLD or FRED:DGS10.", field: "ticker" };
  if (/^CSV$/i.test(ticker) && typeof b.csv !== "string") return { ok: false, error: "csv is required when ticker is CSV.", field: "csv" };

  let spec = defaultSpec(today, style ?? undefined, templateId);
  if (style) spec = applyStyle(spec, style, templateId);

  let period: ChartPeriod = "5Y";
  if (b.period !== undefined) {
    const p = String(b.period).toUpperCase();
    if (!(CHART_PERIODS as readonly string[]).includes(p) || p === "CUSTOM") return { ok: false, error: `period must be one of ${CHART_PERIODS.filter((x) => x !== "CUSTOM").join(", ")}.`, field: "period" };
    period = p as ChartPeriod;
  }
  let from: string | null = null;
  let to: string | null = null;
  if (b.from !== undefined || b.to !== undefined) {
    from = typeof b.from === "string" && ISO.test(b.from) ? b.from : null;
    to = typeof b.to === "string" && ISO.test(b.to) ? b.to : b.to === undefined ? today : null;
    if (!from) return { ok: false, error: "from must be YYYY-MM-DD.", field: "from" };
    if (!to) return { ok: false, error: "to must be YYYY-MM-DD.", field: "to" };
    if (from > to) return { ok: false, error: "from is after to.", field: "from" };
    period = "CUSTOM";
  }
  let interval: ChartInterval;
  if (b.interval !== undefined) {
    if (!(INTERVALS as readonly string[]).includes(String(b.interval))) return { ok: false, error: `interval must be one of ${INTERVALS.join(", ")}.`, field: "interval" };
    interval = b.interval as ChartInterval;
  } else interval = autoInterval(period, from, to);

  if (b.chartType !== undefined && !(CHART_TYPES as readonly string[]).includes(String(b.chartType))) return { ok: false, error: `chartType must be one of ${CHART_TYPES.join(", ")}.`, field: "chartType" };
  if (b.perfColors !== undefined && typeof b.perfColors !== "boolean" && !(PERF_COLORS as readonly string[]).includes(String(b.perfColors))) return { ok: false, error: `perfColors must be true, false or one of ${PERF_COLORS.join(", ")}.`, field: "perfColors" };
  if (b.compareMode !== undefined && !(COMPARE_MODES as readonly string[]).includes(String(b.compareMode))) return { ok: false, error: `compareMode must be one of ${COMPARE_MODES.join(", ")}.`, field: "compareMode" };
  if (b.compare !== undefined && !Array.isArray(b.compare)) return { ok: false, error: "compare must be a list of tickers or { ticker, label, color }.", field: "compare" };
  let size: SizePreset | null = null;
  if (b.size !== undefined) {
    const name = String(b.size).toLowerCase();
    size = (Object.keys(SIZE_PRESETS) as SizePreset[]).find((key) => key.toLowerCase() === name) ?? SIZE_ALIASES[name] ?? null;
    if (!size) return { ok: false, error: `size must be one of ${Object.keys(SIZE_PRESETS).join(", ")}.`, field: "size" };
  }

  const raw: Record<string, unknown> = {
    ...spec,
    data: {
      ...spec.data,
      symbol: ticker,
      period,
      from: from ?? spec.data.from,
      to: to ?? spec.data.to,
      interval,
      adjust: b.adjust === "total" ? "total" : "split",
      csv: typeof b.csv === "string" ? b.csv : "",
      extended: b.extendedHours === true,
      compare: Array.isArray(b.compare) ? normalizeCompare(b.compare.map((item) => (typeof item === "string" ? { symbol: item } : { ...o(item), symbol: o(item).ticker ?? o(item).symbol }))) : [],
      compareMode: b.compareMode ?? "pct",
    },
  };
  if (size) raw.size = { preset: size };
  if (b.chartType !== undefined) raw.chartType = b.chartType;
  if (b.perfColors !== undefined) raw.perfColors = b.perfColors === true ? "overall" : b.perfColors === false ? "off" : b.perfColors;
  for (const key of ["title", "subtitle", "footerLeft", "footerRight"] as const) if (typeof b[key] === "string") raw[key] = b[key];
  if (b.decimals !== undefined) raw.pctDecimals = b.decimals;
  if (b.yRange === "zero") raw.theme = { ...spec.theme, startAtZero: true };
  if (b.yRange === "fit") raw.theme = { ...spec.theme, startAtZero: false };
  const out = normalizeSpec(raw, today);
  if (typeof b.headline === "string") {
    const text = b.headline.replace(/\\n/g, "\n").slice(0, 400);
    const head = out.overlays.find((overlay): overlay is HeadlineOverlay => overlay.type === "headline");
    if (head) head.text = text;
    else
      out.overlays.unshift({ id: "headline", type: "headline", text, x: 0.06, y: 0.24, style: { size: 104, weight: 800, color: "#0b1220", uppercase: true }, align: "left", box: { fill: "#facc15", radius: 18, padX: 40, padY: 26 }, overridden: false });
  }
  if (!out.title && typeof b.title !== "string") out.title = "{name}";
  return { ok: true, spec: out };
}

export type BotBulk = { rows: Array<{ index: number; body: Record<string, unknown> }>; errors: string[] };

/** Bulk rows: each row is a short request; `defaults` fills what a row leaves out. */
export function botBulkRows(body: unknown): BotBulk {
  const b = o(body);
  const defaults = o(b.defaults);
  if (!Array.isArray(b.rows) || b.rows.length === 0) return { rows: [], errors: ["rows must be a non-empty list."] };
  if (b.rows.length > BULK_MAX_ROWS) return { rows: [], errors: [`A batch makes up to ${BULK_MAX_ROWS} charts; you sent ${b.rows.length}.`] };
  const shared = { template: b.template, size: b.size };
  return { rows: b.rows.map((row, index) => ({ index, body: { ...defaults, ...shared, ...o(row) } })), errors: [] };
}
