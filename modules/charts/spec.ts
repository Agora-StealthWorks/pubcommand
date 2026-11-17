/**
 * The chart contract. The editor, templates, bulk runs and exports all speak ChartSpec, and the renderer
 * turns (spec, bars) into SVG. Anything not described here cannot appear on a chart.
 *
 * Positions are fractions (0..1) of the canvas, so a chart keeps its composition at every size. Sizes
 * (fonts, line widths, paddings) are in DESIGN units: the canvas the style was designed at. The renderer
 * scales them to the real canvas, so one template works for a 2:1 promo and a 9:16 story.
 *
 * `normalizeSpec` is the only way untrusted JSON (a form post, a template row) becomes a ChartSpec: it
 * clamps numbers, drops unknown fields, and only accepts safe color strings.
 */

export const SIZE_PRESETS = {
  promo: { w: 2000, h: 1000, label: "Promo wide 2:1" },
  social: { w: 1200, h: 628, label: "Social link 1.91:1" },
  square: { w: 1080, h: 1080, label: "Square 1:1" },
  portrait: { w: 1080, h: 1350, label: "Portrait 4:5" },
  story: { w: 1080, h: 1920, label: "Story 9:16" },
  video: { w: 1920, h: 1080, label: "Video 16:9" },
  newsletter: { w: 1100, h: 650, label: "Newsletter" },
} as const;
export type SizePreset = keyof typeof SIZE_PRESETS;

export const FONT_WEIGHTS = [400, 600, 700, 800] as const;
export type FontWeight = (typeof FONT_WEIGHTS)[number];

export const INTERVALS = ["day", "week", "month", "hour", "5min"] as const;
export type ChartInterval = (typeof INTERVALS)[number];

export const CHART_PERIODS = ["1M", "3M", "6M", "YTD", "1Y", "3Y", "5Y", "10Y", "20Y", "MAX", "CUSTOM"] as const;
export type ChartPeriod = (typeof CHART_PERIODS)[number];

export const TEMPLATE_CATEGORIES = ["PROMO", "PUBLICATION"] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export type TextStyle = { size: number; weight: FontWeight; color: string; uppercase: boolean };
export type Align = "left" | "center" | "right";

export type HeadlineOverlay = {
  id: string;
  type: "headline";
  /** May hold tokens: {gain} {gainRounded} {start} {end} {cagr} {years} {ticker} {name}. */
  text: string;
  x: number;
  y: number;
  style: TextStyle;
  align: Align;
  box: { fill: string; radius: number; padX: number; padY: number } | null;
  /** Set when the text carries a typed figure instead of the computed tokens. */
  overridden: boolean;
};
export type TextOverlay = { id: string; type: "text"; text: string; x: number; y: number; style: TextStyle; align: Align };
export type CalloutOverlay = {
  id: string;
  type: "callout";
  text: string;
  x: number;
  y: number;
  style: TextStyle;
  fill: string;
  radius: number;
  /** "start" | "end" | "high" | "low" | YYYY-MM-DD: draws a leader line to that bar. */
  pointAt: string | null;
  lineColor: string;
};
export type ArrowOverlay = {
  id: string;
  type: "arrow";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** -1..1: 0 is straight, 1 is a full swoop. */
  bend: number;
  color: string;
  width: number;
};
export type DotOverlay = {
  id: string;
  type: "dot";
  at: string;
  color: string;
  radius: number;
  label: string;
  labelStyle: TextStyle;
};
export type ImageOverlay = {
  id: string;
  type: "image";
  assetId: string;
  x: number;
  y: number;
  /** Width as a fraction of the canvas width; height follows `aspect` (w / h). */
  w: number;
  aspect: number;
  opacity: number;
};
export type Overlay = HeadlineOverlay | TextOverlay | CalloutOverlay | ArrowOverlay | DotOverlay | ImageOverlay;
export type OverlayType = Overlay["type"];

export type Theme = {
  background: string;
  /** Second color for a top-to-bottom gradient. null = solid. */
  background2: string | null;
  title: TextStyle;
  subtitle: TextStyle;
  axis: TextStyle;
  footer: TextStyle;
  line: { color: string; width: number };
  area: { color: string; opacity: number };
  candle: { up: string; down: string };
  grid: { color: string; width: number; dashed: boolean; show: boolean };
  axisSide: "right" | "left" | "none";
  startAtZero: boolean;
  /** Outer padding as a fraction of the shorter side. */
  padding: number;
  /** The plot as a card. null = no card. */
  plot: { fill: string; radius: number } | null;
  /** Short bar before the title. */
  titleAccent: string | null;
};

export const CHART_TYPES = ["area", "line", "candle", "ohlc"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

/**
 * Performance coloring, in the theme's up/down colors (theme.candle):
 * overall = the whole line and fill by the total move; segments = each bar-to-bar step by its direction.
 */
export const PERF_COLORS = ["off", "overall", "segments"] as const;
export type PerfColors = (typeof PERF_COLORS)[number];

/** What a template stores: everything except the data and the title. */
export type StyleSpec = {
  chartType: ChartType;
  perfColors: PerfColors;
  design: { w: number; h: number };
  theme: Theme;
  overlays: Overlay[];
  subtitle: string;
  footerLeft: string;
  footerRight: string;
};

/** Another line on the same chart. Its numbers come from its own bars, like the main line's. */
export type CompareLine = { symbol: string; label: string; color: string };
export const MAX_COMPARE = 4;
/** rebase = every line starts at 100; pct = every line is % change from its first bar. */
export const COMPARE_MODES = ["pct", "rebase"] as const;
export type CompareMode = (typeof COMPARE_MODES)[number];

export type DataSpec = {
  /** Ticker (AMD), crypto (BTC-USD), ratio (CPER/GLD), FRED series (FRED:PCOPPUSDM), or CSV. */
  symbol: string;
  period: ChartPeriod;
  from: string;
  to: string;
  interval: ChartInterval;
  /** split = price only (honest quote history). total = dividends reinvested. */
  adjust: "split" | "total";
  /** Pasted data when symbol is CSV. */
  csv: string;
  /** Intraday only: include pre-market (from 4:00) and after-hours (to 20:00 New York), shaded. */
  extended: boolean;
  /** Extra lines. When set, every line is drawn rebased (see compareMode) on one axis. */
  compare: CompareLine[];
  compareMode: CompareMode;
};

export type ChartSpec = StyleSpec & {
  size: { preset: SizePreset | "custom"; w: number; h: number };
  data: DataSpec;
  title: string;
  templateId: string | null;
  /** Decimals for % figures in {gain} and {cagr}. */
  pctDecimals: number;
  /** On a loss, "{gain} gain" reads "12% loss". */
  lossWord: boolean;
};

// ----------------------------------------------------------------------------- sanitizing

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGBA = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/;
const NAMED = new Set(["white", "black", "transparent", "none"]);

export function safeColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const v = value.trim();
  return HEX.test(v) || RGBA.test(v) || NAMED.has(v.toLowerCase()) ? v : fallback;
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function str(value: unknown, fallback: string, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function pick<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === "string" && (options as readonly string[]).includes(value) ? (value as T) : fallback;
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function weight(value: unknown, fallback: FontWeight): FontWeight {
  const n = num(value, fallback, 100, 900);
  return FONT_WEIGHTS.reduce((best, w) => (Math.abs(w - n) < Math.abs(best - n) ? w : best), FONT_WEIGHTS[0]);
}

export function textStyle(value: unknown, fallback: TextStyle): TextStyle {
  const o = obj(value);
  return {
    size: num(o.size, fallback.size, 4, 600),
    weight: weight(o.weight, fallback.weight),
    color: safeColor(o.color, fallback.color),
    uppercase: bool(o.uppercase, fallback.uppercase),
  };
}

const POS_MIN = -0.5;
const POS_MAX = 1.5;
const pos = (value: unknown, fallback: number) => num(value, fallback, POS_MIN, POS_MAX);
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const AT = /^(start|end|high|low|\d{4}-\d{2}-\d{2})$/;

export const MAX_OVERLAYS = 40;

export function normalizeOverlay(value: unknown, index = 0): Overlay | null {
  const o = obj(value);
  const id = typeof o.id === "string" && ID.test(o.id) ? o.id : `o${index + 1}`;
  const text = (fallback = "") => str(o.text, fallback, 400);
  const style = (fallback: TextStyle) => textStyle(o.style, fallback);
  switch (o.type) {
    case "headline": {
      const box = o.box == null ? null : obj(o.box);
      return {
        id,
        type: "headline",
        text: text("{gain}"),
        x: pos(o.x, 0.06),
        y: pos(o.y, 0.3),
        style: style(DEFAULT_HEADLINE_STYLE),
        align: pick(o.align, ["left", "center", "right"] as const, "left"),
        box: box
          ? {
              fill: safeColor(box.fill, "#facc15"),
              radius: num(box.radius, 16, 0, 200),
              padX: num(box.padX, 36, 0, 200),
              padY: num(box.padY, 18, 0, 200),
            }
          : null,
        overridden: bool(o.overridden, false),
      };
    }
    case "text":
      return { id, type: "text", text: text("Text"), x: pos(o.x, 0.1), y: pos(o.y, 0.1), style: style(DEFAULT_TEXT_STYLE), align: pick(o.align, ["left", "center", "right"] as const, "left") };
    case "callout":
      return {
        id,
        type: "callout",
        text: text("Callout"),
        x: pos(o.x, 0.5),
        y: pos(o.y, 0.4),
        style: style(DEFAULT_CALLOUT_STYLE),
        fill: safeColor(o.fill, "#ffffff"),
        radius: num(o.radius, 12, 0, 100),
        pointAt: typeof o.pointAt === "string" && AT.test(o.pointAt) ? o.pointAt : null,
        lineColor: safeColor(o.lineColor, "#ffffff"),
      };
    case "arrow":
      return {
        id,
        type: "arrow",
        x1: pos(o.x1, 0.3),
        y1: pos(o.y1, 0.75),
        x2: pos(o.x2, 0.7),
        y2: pos(o.y2, 0.35),
        bend: num(o.bend, 0.4, -1, 1),
        color: safeColor(o.color, "#ffffff"),
        width: num(o.width, 12, 1, 80),
      };
    case "dot":
      return {
        id,
        type: "dot",
        at: typeof o.at === "string" && AT.test(o.at) ? o.at : "end",
        color: safeColor(o.color, "#ffffff"),
        radius: num(o.radius, 14, 1, 80),
        label: str(o.label, "", 80),
        labelStyle: textStyle(o.labelStyle, DEFAULT_DOT_LABEL_STYLE),
      };
    case "image":
      if (typeof o.assetId !== "string" || !/^[0-9a-f-]{36}$/i.test(o.assetId)) return null;
      return {
        id,
        type: "image",
        assetId: o.assetId.toLowerCase(),
        x: pos(o.x, 0.8),
        y: pos(o.y, 0.05),
        w: num(o.w, 0.15, 0.01, 2),
        aspect: num(o.aspect, 1, 0.01, 100),
        opacity: num(o.opacity, 1, 0, 1),
      };
    default:
      return null;
  }
}

export const DEFAULT_HEADLINE_STYLE: TextStyle = { size: 120, weight: 800, color: "#0b1220", uppercase: true };
export const DEFAULT_TEXT_STYLE: TextStyle = { size: 48, weight: 700, color: "#ffffff", uppercase: false };
export const DEFAULT_CALLOUT_STYLE: TextStyle = { size: 40, weight: 700, color: "#0b1220", uppercase: false };
export const DEFAULT_DOT_LABEL_STYLE: TextStyle = { size: 36, weight: 700, color: "#ffffff", uppercase: false };

export const DEFAULT_THEME: Theme = {
  background: "#ffffff",
  background2: null,
  title: { size: 72, weight: 800, color: "#0b1220", uppercase: false },
  subtitle: { size: 40, weight: 400, color: "#3e4a5c", uppercase: false },
  axis: { size: 30, weight: 400, color: "#3e4a5c", uppercase: false },
  footer: { size: 24, weight: 400, color: "#6b7280", uppercase: false },
  line: { color: "#1d4ed8", width: 6 },
  area: { color: "#1d4ed8", opacity: 0.25 },
  candle: { up: "#16a34a", down: "#dc2626" },
  grid: { color: "#e1e4ea", width: 2, dashed: false, show: true },
  axisSide: "right",
  startAtZero: false,
  padding: 0.05,
  plot: null,
  titleAccent: null,
};

export function normalizeTheme(value: unknown, base: Theme = DEFAULT_THEME): Theme {
  const o = obj(value);
  const line = obj(o.line);
  const area = obj(o.area);
  const candle = obj(o.candle);
  const grid = obj(o.grid);
  const plot = o.plot === null ? null : o.plot === undefined ? base.plot : obj(o.plot);
  return {
    background: safeColor(o.background, base.background),
    background2: o.background2 === null ? null : o.background2 === undefined ? base.background2 : safeColor(o.background2, base.background2 ?? base.background),
    title: textStyle(o.title, base.title),
    subtitle: textStyle(o.subtitle, base.subtitle),
    axis: textStyle(o.axis, base.axis),
    footer: textStyle(o.footer, base.footer),
    line: { color: safeColor(line.color, base.line.color), width: num(line.width, base.line.width, 0.5, 40) },
    area: { color: safeColor(area.color, base.area.color), opacity: num(area.opacity, base.area.opacity, 0, 1) },
    candle: { up: safeColor(candle.up, base.candle.up), down: safeColor(candle.down, base.candle.down) },
    grid: {
      color: safeColor(grid.color, base.grid.color),
      width: num(grid.width, base.grid.width, 0.5, 10),
      dashed: bool(grid.dashed, base.grid.dashed),
      show: bool(grid.show, base.grid.show),
    },
    axisSide: pick(o.axisSide, ["right", "left", "none"] as const, base.axisSide),
    startAtZero: bool(o.startAtZero, base.startAtZero),
    padding: num(o.padding, base.padding, 0, 0.3),
    plot: plot
      ? { fill: safeColor(plot.fill, base.plot?.fill ?? "#ffffff"), radius: num(plot.radius, base.plot?.radius ?? 0, 0, 200) }
      : null,
    titleAccent: o.titleAccent === null ? null : o.titleAccent === undefined ? base.titleAccent : safeColor(o.titleAccent, base.titleAccent ?? "#1d4ed8"),
  };
}

function overlays(value: unknown): Overlay[] {
  if (!Array.isArray(value)) return [];
  const out: Overlay[] = [];
  const seen = new Set<string>();
  value.slice(0, MAX_OVERLAYS).forEach((item, index) => {
    const overlay = normalizeOverlay(item, index);
    if (!overlay) return;
    if (seen.has(overlay.id)) overlay.id = `${overlay.id}-${index}`;
    seen.add(overlay.id);
    out.push(overlay);
  });
  return out;
}

export function normalizeStyle(value: unknown): StyleSpec {
  const o = obj(value);
  const design = obj(o.design);
  return {
    chartType: pick(o.chartType, CHART_TYPES, "area"),
    perfColors: pick(o.perfColors, PERF_COLORS, "off"),
    design: { w: Math.round(num(design.w, 2000, 200, 4000)), h: Math.round(num(design.h, 1000, 200, 4000)) },
    theme: normalizeTheme(o.theme),
    overlays: overlays(o.overlays),
    subtitle: str(o.subtitle, "", 200),
    footerLeft: str(o.footerLeft, "", 200),
    footerRight: str(o.footerRight, "", 200),
  };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const CSV_MAX_CHARS = 2_000_000;

export const COMPARE_COLORS = ["#f97316", "#a855f7", "#10b981", "#ef4444"] as const;
const COMPARE_SYMBOL = /^[A-Za-z0-9.\-^:=&/ ]{1,40}$/;

export function normalizeCompare(value: unknown): CompareLine[] {
  if (!Array.isArray(value)) return [];
  const out: CompareLine[] = [];
  for (const item of value.slice(0, MAX_COMPARE * 2)) {
    const o = typeof item === "string" ? { symbol: item } : obj(item);
    const symbol = str(o.symbol, "", 40).trim();
    if (!symbol || !COMPARE_SYMBOL.test(symbol) || /^CSV$/i.test(symbol)) continue;
    if (out.some((line) => line.symbol.toUpperCase() === symbol.toUpperCase())) continue;
    out.push({ symbol, label: str(o.label, "", 60).trim(), color: safeColor(o.color, COMPARE_COLORS[out.length % COMPARE_COLORS.length] as string) });
    if (out.length >= MAX_COMPARE) break;
  }
  return out;
}

export function normalizeData(value: unknown, today: string): DataSpec {
  const o = obj(value);
  const symbol = str(o.symbol, "AAPL", 60).trim() || "AAPL";
  return {
    symbol,
    period: pick(o.period, CHART_PERIODS, "1Y"),
    from: typeof o.from === "string" && ISO.test(o.from) ? o.from : `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`,
    to: typeof o.to === "string" && ISO.test(o.to) ? o.to : today,
    interval: pick(o.interval, INTERVALS, "day"),
    adjust: pick(o.adjust, ["split", "total"] as const, "split"),
    csv: str(o.csv, "", CSV_MAX_CHARS),
    extended: bool(o.extended, false),
    compare: normalizeCompare(o.compare),
    compareMode: pick(o.compareMode, COMPARE_MODES, "pct"),
  };
}

export function normalizeSpec(value: unknown, today: string): ChartSpec {
  const o = obj(value);
  const style = normalizeStyle(o);
  const size = obj(o.size);
  const preset = pick(size.preset, [...(Object.keys(SIZE_PRESETS) as SizePreset[]), "custom"] as const, "promo");
  const presetSize = preset === "custom" ? null : SIZE_PRESETS[preset];
  return {
    ...style,
    size: {
      preset,
      w: presetSize ? presetSize.w : Math.round(num(size.w, 2000, 200, 4000)),
      h: presetSize ? presetSize.h : Math.round(num(size.h, 1000, 200, 4000)),
    },
    data: normalizeData(o.data, today),
    title: str(o.title, "", 200),
    templateId: typeof o.templateId === "string" && /^[0-9a-f-]{36}$/i.test(o.templateId) ? o.templateId : null,
    pctDecimals: Math.round(num(o.pctDecimals, 0, 0, 2)),
    lossWord: bool(o.lossWord, true),
  };
}

/** The template part of a chart. */
export function styleOf(spec: ChartSpec): StyleSpec {
  return normalizeStyle({ ...spec, design: spec.design });
}

/**
 * Put a template's look on a chart and keep the chart's data, title and size. Overlay text the user
 * already typed for a headline is kept when the template also has a headline.
 */
export function applyStyle(spec: ChartSpec, style: StyleSpec, templateId: string | null): ChartSpec {
  const headline = spec.overlays.find((overlay): overlay is HeadlineOverlay => overlay.type === "headline");
  const nextOverlays = structuredClone(style.overlays).map((overlay) =>
    overlay.type === "headline" && headline ? { ...overlay, text: headline.text, overridden: headline.overridden } : overlay,
  );
  return { ...spec, ...structuredClone(style), overlays: nextOverlays, templateId };
}
