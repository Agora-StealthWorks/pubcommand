/**
 * THE renderer: (spec, bars) → SVG string. Pure and deterministic. The editor preview, the saved-chart
 * thumbnails and every export (SVG, PNG, JPG, PDF) call it, so what you see is what you download.
 * Text is measured from the bundled Inter metrics (font-metrics.ts), never from a browser canvas.
 */
import { METRIC_CHARS, METRIC_WIDTHS } from "./font-metrics";
import type { ArrowOverlay, CalloutOverlay, ChartSpec, DotOverlay, FontWeight, HeadlineOverlay, ImageOverlay, TextOverlay, TextStyle } from "./spec";
import { computeStats, displayText, fmtPrice, tokenValues, type ChartBar, type SeriesStats } from "./tokens";

export const FONT_STACK = "Inter, Arial, Helvetica, sans-serif";

const CHAR_INDEX = new Map([...METRIC_CHARS].map((char, index) => [char, index]));

/** Width in px of `text` in Inter at `weight` and `size`. */
export function measureText(text: string, weight: FontWeight, size: number): number {
  const widths = METRIC_WIDTHS[weight];
  let total = 0;
  for (const char of text) {
    const index = CHAR_INDEX.get(char);
    total += index == null ? 600 : (widths[index] ?? 600);
  }
  return (total / 1000) * size;
}

export function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

const r = (n: number) => (Math.round(n * 100) / 100).toString();

/**
 * Design units → canvas pixels. Geometric mean of the axis ratios keeps visual weight on square and
 * story formats; capped at 1.4× the width ratio so text never outgrows a narrow canvas.
 */
export function scaleFactor(spec: Pick<ChartSpec, "size" | "design">): number {
  const kw = spec.size.w / spec.design.w;
  const kh = spec.size.h / spec.design.h;
  return Math.min(kw * 1.4, Math.sqrt(kw * kh));
}

export type ChartMeta = {
  ticker: string;
  name: string;
  source: string;
  unit: string;
};

export type Rect = { x: number; y: number; w: number; h: number };

export type ChartLayout = {
  width: number;
  height: number;
  k: number;
  plot: Rect;
  yMin: number;
  yMax: number;
  ticks: number[];
  step: number;
  /** x of bar i. */
  x: (index: number) => number;
  /** y of a price. */
  y: (value: number) => number;
};

// ----------------------------------------------------------------------------- scales

/** Clean steps: 1, 2, 2.5, 5 × 10^n. */
export function niceTicks(min: number, max: number, count = 5): { lo: number; hi: number; step: number; ticks: number[] } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { lo: 0, hi: 1, step: 0.25, ticks: [0, 0.25, 0.5, 0.75, 1] };
  if (max - min < 1e-12) {
    const pad = Math.abs(max) * 0.05 || 1;
    min -= pad;
    max += pad;
  }
  const rough = (max - min) / Math.max(1, count - 1);
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = ([1, 2, 2.5, 5, 10].map((m) => m * power).find((candidate) => candidate >= rough) ?? 10 * power) as number;
  const lo = Math.floor(min / step + 1e-9) * step;
  const hi = Math.ceil(max / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
  return { lo, hi, step, ticks };
}

export function formatTick(value: number, step: number, unit: string): string {
  const decimals = step >= 1 ? 0 : Math.min(6, Math.ceil(-Math.log10(step) - 1e-9));
  const fixed = Math.abs(value) < 1e-12 ? 0 : value;
  return `${unit}${fixed.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

type DateTick = { index: number; label: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ET_TIME = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const ET_DAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });

/** Labels at calendar boundaries (new year, quarter, month, day), the finest that fits `maxLabels`. */
export function dateTicks(bars: readonly ChartBar[], maxLabels: number): DateTick[] {
  if (bars.length < 2) return [];
  const first = bars[0] as ChartBar;
  const last = bars[bars.length - 1] as ChartBar;
  const intraday = (last.t - first.t) / Math.max(1, bars.length - 1) < 20 * 3_600_000 && (last.t - first.t) < 40 * 86_400_000 && bars.some((bar) => bar.t % 86_400_000 !== 0);
  if (intraday) {
    const ticks: DateTick[] = [];
    for (let i = 1; i < bars.length; i += 1) {
      if (ET_DAY.format((bars[i] as ChartBar).t) !== ET_DAY.format((bars[i - 1] as ChartBar).t)) ticks.push({ index: i, label: ET_DAY.format((bars[i] as ChartBar).t) });
    }
    if (ticks.length >= 2) return thin(ticks, maxLabels);
    const hours: DateTick[] = [];
    for (let i = 0; i < bars.length; i += Math.max(1, Math.ceil(bars.length / Math.max(2, maxLabels)))) hours.push({ index: i, label: ET_TIME.format((bars[i] as ChartBar).t) });
    return hours;
  }
  const spanDays = (last.t - first.t) / 86_400_000;
  const units: Array<{ key: (d: Date) => number; label: (d: Date) => string }> = [
    { key: (d) => Math.floor(d.getTime() / 86_400_000), label: (d) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}` },
    { key: (d) => Math.floor((d.getTime() / 86_400_000 + 3) / 7), label: (d) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}` },
    ...[1, 3, 6].map((step) => ({
      key: (d: Date) => Math.floor((d.getUTCFullYear() * 12 + d.getUTCMonth()) / step),
      label: (d: Date) => (spanDays > 330 || d.getUTCMonth() === 0 ? `${MONTHS[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}` : (MONTHS[d.getUTCMonth()] as string)),
    })),
    ...[1, 2, 5, 10, 20].map((step) => ({ key: (d: Date) => Math.floor(d.getUTCFullYear() / step), label: (d: Date) => String(d.getUTCFullYear()) })),
  ];
  for (const unit of units) {
    const ticks: DateTick[] = [];
    for (let i = 1; i < bars.length; i += 1) {
      const d = new Date((bars[i] as ChartBar).t);
      if (unit.key(d) !== unit.key(new Date((bars[i - 1] as ChartBar).t))) ticks.push({ index: i, label: unit.label(d) });
    }
    if (ticks.length >= 1 && ticks.length <= maxLabels) return ticks;
  }
  return [];
}

function thin(ticks: DateTick[], maxLabels: number): DateTick[] {
  if (ticks.length <= maxLabels) return ticks;
  const every = Math.ceil(ticks.length / maxLabels);
  return ticks.filter((_tick, index) => index % every === 0);
}

/** Index of the bar for "start" | "end" | "high" | "low" | YYYY-MM-DD (nearest bar). -1 if none. */
export function barIndex(bars: readonly ChartBar[], at: string): number {
  if (!bars.length) return -1;
  if (at === "start") return 0;
  if (at === "end") return bars.length - 1;
  if (at === "high" || at === "low") {
    let best = 0;
    for (let i = 1; i < bars.length; i += 1) {
      const c = (bars[i] as ChartBar).c;
      const b = (bars[best] as ChartBar).c;
      if (at === "high" ? c > b : c < b) best = i;
    }
    return best;
  }
  const t = Date.parse(`${at}T00:00:00Z`);
  if (!Number.isFinite(t)) return -1;
  let best = 0;
  for (let i = 1; i < bars.length; i += 1) {
    if (Math.abs((bars[i] as ChartBar).t - t) < Math.abs((bars[best] as ChartBar).t - t)) best = i;
  }
  return best;
}

// ----------------------------------------------------------------------------- layout

function textLines(text: string, style: TextStyle): string[] {
  const shown = style.uppercase ? text.toUpperCase() : text;
  return shown.split(/\r?\n/).slice(0, 8);
}

function headerHeights(spec: ChartSpec, k: number, title: string, subtitle: string) {
  const titleSize = spec.theme.title.size * k;
  const subtitleSize = spec.theme.subtitle.size * k;
  let height = 0;
  if (title) height += titleSize * 1.1;
  if (subtitle) height += subtitleSize * 1.35;
  return { titleSize, subtitleSize, height };
}

export function chartLayout(spec: ChartSpec, bars: readonly ChartBar[], meta: ChartMeta, texts?: { title: string; subtitle: string; footer: boolean }): ChartLayout {
  const W = spec.size.w;
  const H = spec.size.h;
  const k = scaleFactor(spec);
  const t = spec.theme;
  const pad = t.padding * Math.min(W, H);
  const axisSize = t.axis.size * k;
  const header = headerHeights(spec, k, texts?.title ?? spec.title, texts?.subtitle ?? spec.subtitle);
  const footerH = (texts?.footer ?? true) ? t.footer.size * k * 1.6 : 0;
  const values = bars.flatMap((bar) => (spec.chartType === "candle" ? [bar.h, bar.l] : [bar.c]));
  let min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  if (t.startAtZero && min > 0) min = 0;
  const span = max - min || Math.abs(max) || 1;
  const scale = niceTicks(t.startAtZero && min === 0 ? 0 : min - span * 0.03, max + span * 0.03, 5);
  const labelW = t.axisSide === "none" ? 0 : Math.max(...scale.ticks.map((tick) => measureText(formatTick(tick, scale.step, meta.unit), t.axis.weight, axisSize))) + axisSize * 0.7;
  const inset = t.plot ? axisSize * 0.9 : 0;
  const top = pad + header.height + axisSize * 1.1 + inset;
  const bottom = H - pad - footerH - axisSize * 1.6 - inset;
  const left = pad + inset + (t.axisSide === "left" ? labelW : 0);
  const right = W - pad - inset - (t.axisSide === "right" ? labelW : 0);
  const plot: Rect = { x: left, y: top, w: Math.max(10, right - left), h: Math.max(10, bottom - top) };
  const n = bars.length;
  const yMin = scale.lo;
  const yMax = scale.hi;
  return {
    width: W,
    height: H,
    k,
    plot,
    yMin,
    yMax,
    ticks: scale.ticks,
    step: scale.step,
    x: (index) => plot.x + (n <= 1 ? plot.w / 2 : (index / (n - 1)) * plot.w),
    y: (value) => plot.y + plot.h - ((value - yMin) / (yMax - yMin || 1)) * plot.h,
  };
}

// ----------------------------------------------------------------------------- render

export type RenderInput = {
  spec: ChartSpec;
  bars: readonly ChartBar[];
  meta: ChartMeta;
  /** Where an image overlay's asset lives: a URL in the browser, a data: URI on the server. */
  imageHref?: (assetId: string) => string | null;
  /** Prefix for gradient ids, so several charts can share one HTML page. */
  idPrefix?: string;
};

export type RenderResult = { svg: string; stats: SeriesStats | null; tokens: Record<string, string>; layout: ChartLayout };

function textAttrs(style: TextStyle, size: number): string {
  return `font-family="${FONT_STACK}" font-size="${r(size)}" font-weight="${style.weight}" fill="${style.color}"`;
}

/** Shrink a single line until it fits `maxWidth`. */
function fitSize(text: string, style: TextStyle, size: number, maxWidth: number): number {
  const width = measureText(text, style.weight, size);
  return width > maxWidth && width > 0 ? Math.max(size * 0.4, size * (maxWidth / width)) : size;
}

function anchorFor(align: "left" | "center" | "right"): string {
  return align === "center" ? "middle" : align === "right" ? "end" : "start";
}

type Block = { width: number; height: number; size: number; lines: string[]; lineHeight: number; capOffset: number };

function block(text: string, style: TextStyle, k: number): Block {
  const size = style.size * k;
  const lines = textLines(text, style);
  const lineHeight = size * 1.08;
  const width = Math.max(1, ...lines.map((line) => measureText(line, style.weight, size)));
  const ink = lines.some((line) => /[gjpqy,()]/.test(line)) ? 0.93 : 0.74;
  return { width, height: (lines.length - 1) * lineHeight + size * ink, size, lines, lineHeight, capOffset: size * 0.74 };
}

function blockText(b: Block, style: TextStyle, x: number, top: number, align: "left" | "center" | "right"): string {
  const anchorX = align === "center" ? x + b.width / 2 : align === "right" ? x + b.width : x;
  return b.lines
    .map((line, index) => `<text x="${r(anchorX)}" y="${r(top + b.capOffset + index * b.lineHeight)}" text-anchor="${anchorFor(align)}" ${textAttrs(style, b.size)}>${xml(line)}</text>`)
    .join("");
}

export function renderChart(input: RenderInput): RenderResult {
  const { spec, bars, meta } = input;
  const id = (name: string) => `${input.idPrefix ?? "c"}-${name}`;
  const stats = computeStats(bars);
  const tokens = tokenValues(stats, { ticker: meta.ticker, name: meta.name, source: meta.source, unit: meta.unit, pctDecimals: spec.pctDecimals });
  const show = (text: string) => displayText(text, tokens, stats?.gainPct, spec.lossWord);
  const t = spec.theme;
  const W = spec.size.w;
  const H = spec.size.h;
  const title = show(spec.title).trim();
  const subtitle = show(spec.subtitle).trim();
  const footerLeft = show(spec.footerLeft || "Source: {source}").trim();
  const footerRight = show(spec.footerRight).trim();
  const layout = chartLayout(spec, bars, meta, { title, subtitle, footer: Boolean(footerLeft || footerRight) });
  const { k, plot } = layout;
  const pad = t.padding * Math.min(W, H);
  const axisSize = t.axis.size * k;
  const parts: string[] = [];
  const defs: string[] = [];

  // Background
  if (t.background2) {
    defs.push(`<linearGradient id="${id("bg")}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.background}"/><stop offset="1" stop-color="${t.background2}"/></linearGradient>`);
    parts.push(`<rect width="${W}" height="${H}" fill="url(#${id("bg")})"/>`);
  } else {
    parts.push(`<rect width="${W}" height="${H}" fill="${t.background}"/>`);
  }

  // Header
  const header = headerHeights(spec, k, title, subtitle);
  let cursor = pad;
  const accentW = t.titleAccent ? header.titleSize * 0.14 : 0;
  const textX = pad + (accentW ? accentW + header.titleSize * 0.3 : 0);
  const maxTitleW = W - textX - pad;
  if (title) {
    const lineTitle = t.title.uppercase ? title.toUpperCase() : title;
    const size = fitSize(lineTitle, t.title, header.titleSize, maxTitleW);
    if (accentW) parts.push(`<rect x="${r(pad)}" y="${r(cursor + size * 0.05)}" width="${r(accentW)}" height="${r(size * 0.82)}" rx="${r(accentW / 3)}" fill="${t.titleAccent}"/>`);
    parts.push(`<text x="${r(textX)}" y="${r(cursor + size * 0.8)}" ${textAttrs(t.title, size)}>${xml(lineTitle)}</text>`);
    cursor += header.titleSize * 1.1;
  }
  if (subtitle) {
    const line = t.subtitle.uppercase ? subtitle.toUpperCase() : subtitle;
    const size = fitSize(line, t.subtitle, header.subtitleSize, maxTitleW);
    parts.push(`<text x="${r(textX)}" y="${r(cursor + size * 1.0)}" ${textAttrs(t.subtitle, size)}>${xml(line)}</text>`);
  }

  // Plot card
  if (t.plot) {
    const inset = axisSize * 0.9;
    const card = { x: pad, y: plot.y - inset, w: W - pad * 2, h: plot.h + inset * 2 + axisSize * 1.6 };
    parts.push(`<rect x="${r(card.x)}" y="${r(card.y)}" width="${r(card.w)}" height="${r(card.h)}" rx="${r(t.plot.radius * k)}" fill="${t.plot.fill}"/>`);
  }

  if (bars.length >= 2) {
    // Grid and price labels
    const gridW = Math.max(0.5, t.grid.width * k);
    for (const tick of layout.ticks) {
      const y = layout.y(tick);
      if (t.grid.show) {
        parts.push(`<line x1="${r(plot.x)}" y1="${r(y)}" x2="${r(plot.x + plot.w)}" y2="${r(y)}" stroke="${t.grid.color}" stroke-width="${r(gridW)}"${t.grid.dashed ? ` stroke-dasharray="${r(gridW * 4)} ${r(gridW * 4)}"` : ""}/>`);
      }
      if (t.axisSide !== "none") {
        const label = formatTick(tick, layout.step, meta.unit);
        const x = t.axisSide === "right" ? plot.x + plot.w + axisSize * 0.5 : plot.x - axisSize * 0.5;
        parts.push(`<text x="${r(x)}" y="${r(y + axisSize * 0.36)}" text-anchor="${t.axisSide === "right" ? "start" : "end"}" ${textAttrs(t.axis, axisSize)}>${xml(label)}</text>`);
      }
    }

    // Date labels
    const maxLabels = Math.max(2, Math.floor(plot.w / (axisSize * 5.5)));
    const dateY = plot.y + plot.h + axisSize * 1.35;
    for (const tick of dateTicks(bars, maxLabels)) {
      const x = layout.x(tick.index);
      const half = measureText(tick.label, t.axis.weight, axisSize) / 2;
      if (x - half < plot.x - axisSize * 0.5 || x + half > W - pad) continue;
      parts.push(`<text x="${r(x)}" y="${r(dateY)}" text-anchor="middle" ${textAttrs(t.axis, axisSize)}>${xml(tick.label)}</text>`);
    }

    // Series
    const lineW = Math.max(0.5, t.line.width * k);
    if (spec.chartType === "candle") {
      const bodyW = Math.max(1, (plot.w / bars.length) * 0.62);
      bars.forEach((bar, index) => {
        const x = layout.x(index);
        const color = bar.c >= bar.o ? t.candle.up : t.candle.down;
        const yTop = layout.y(Math.max(bar.o, bar.c));
        const yBottom = layout.y(Math.min(bar.o, bar.c));
        parts.push(`<line x1="${r(x)}" y1="${r(layout.y(bar.h))}" x2="${r(x)}" y2="${r(layout.y(bar.l))}" stroke="${color}" stroke-width="${r(Math.max(1, bodyW / 6))}"/>`);
        parts.push(`<rect x="${r(x - bodyW / 2)}" y="${r(yTop)}" width="${r(bodyW)}" height="${r(Math.max(1, yBottom - yTop))}" fill="${color}"/>`);
      });
    } else {
      const points = bars.map((bar, index) => `${r(layout.x(index))} ${r(layout.y(bar.c))}`);
      const path = `M${points.join("L")}`;
      if (spec.chartType === "area") {
        defs.push(`<linearGradient id="${id("area")}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.area.color}" stop-opacity="${t.area.opacity}"/><stop offset="1" stop-color="${t.area.color}" stop-opacity="0"/></linearGradient>`);
        parts.push(`<path d="${path}L${r(layout.x(bars.length - 1))} ${r(plot.y + plot.h)}L${r(plot.x)} ${r(plot.y + plot.h)}Z" fill="url(#${id("area")})"/>`);
      }
      parts.push(`<path d="${path}" fill="none" stroke="${t.line.color}" stroke-width="${r(lineW)}" stroke-linejoin="round" stroke-linecap="round"/>`);
    }
  } else {
    parts.push(`<text x="${r(plot.x + plot.w / 2)}" y="${r(plot.y + plot.h / 2)}" text-anchor="middle" ${textAttrs(t.axis, axisSize * 1.4)}>No data to chart yet</text>`);
  }

  // Footer
  const footerSize = t.footer.size * k;
  if (footerLeft) parts.push(`<text x="${r(pad)}" y="${r(H - pad)}" ${textAttrs(t.footer, fitSize(footerLeft, t.footer, footerSize, W * 0.62 - pad))}>${xml(footerLeft)}</text>`);
  if (footerRight) parts.push(`<text x="${r(W - pad)}" y="${r(H - pad)}" text-anchor="end" ${textAttrs(t.footer, fitSize(footerRight, t.footer, footerSize, W * 0.36 - pad))}>${xml(footerRight)}</text>`);

  // Overlays, in order (later ones on top)
  const point = (at: string) => {
    const index = barIndex(bars, at);
    if (index < 0) return null;
    const bar = bars[index] as ChartBar;
    return { x: layout.x(index), y: layout.y(spec.chartType === "candle" ? bar.c : bar.c) };
  };
  for (const overlay of spec.overlays) {
    const open = `<g data-overlay-id="${xml(overlay.id)}" data-overlay-type="${overlay.type}">`;
    if (overlay.type === "headline" || overlay.type === "text") parts.push(open + textBlock(overlay, show, k, W, H) + "</g>");
    else if (overlay.type === "callout") parts.push(open + callout(overlay, show, k, W, H, point) + "</g>");
    else if (overlay.type === "arrow") parts.push(open + arrow(overlay, k, W, H) + "</g>");
    else if (overlay.type === "dot") parts.push(open + dot(overlay, k, W, point, t.background, show) + "</g>");
    else if (overlay.type === "image") parts.push(open + image(overlay, W, H, input.imageHref) + "</g>");
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT_STACK}">` +
    (defs.length ? `<defs>${defs.join("")}</defs>` : "") +
    parts.join("") +
    `</svg>`;
  return { svg, stats, tokens, layout };
}

/** Convenience: just the SVG. */
export function renderChartSvg(input: RenderInput): string {
  return renderChart(input).svg;
}

function textBlock(overlay: HeadlineOverlay | TextOverlay, show: (text: string) => string, k: number, W: number, H: number): string {
  const b = block(show(overlay.text), overlay.style, k);
  const x = overlay.x * W;
  const y = overlay.y * H;
  if (overlay.type === "headline" && overlay.box) {
    const padX = overlay.box.padX * k;
    const padY = overlay.box.padY * k;
    return (
      `<rect x="${r(x)}" y="${r(y)}" width="${r(b.width + padX * 2)}" height="${r(b.height + padY * 2)}" rx="${r(overlay.box.radius * k)}" fill="${overlay.box.fill}"/>` +
      blockText(b, overlay.style, x + padX, y + padY, overlay.align)
    );
  }
  return `<rect x="${r(x)}" y="${r(y)}" width="${r(b.width)}" height="${r(b.height)}" fill="#000" fill-opacity="0"/>` + blockText(b, overlay.style, x, y, overlay.align);
}

function callout(
  overlay: CalloutOverlay,
  show: (text: string) => string,
  k: number,
  W: number,
  H: number,
  point: (at: string) => { x: number; y: number } | null,
): string {
  const b = block(show(overlay.text), overlay.style, k);
  const padX = b.size * 0.55;
  const padY = b.size * 0.4;
  const box = { x: overlay.x * W, y: overlay.y * H, w: b.width + padX * 2, h: b.height + padY * 2 };
  let leader = "";
  const target = overlay.pointAt ? point(overlay.pointAt) : null;
  if (target) {
    const cx = Math.min(Math.max(target.x, box.x), box.x + box.w);
    const cy = target.y < box.y ? box.y : box.y + box.h;
    const width = Math.max(1, 3 * k);
    leader =
      `<line x1="${r(cx)}" y1="${r(cy)}" x2="${r(target.x)}" y2="${r(target.y)}" stroke="${overlay.lineColor}" stroke-width="${r(width)}"/>` +
      `<circle cx="${r(target.x)}" cy="${r(target.y)}" r="${r(width * 2.6)}" fill="${overlay.lineColor}"/>`;
  }
  return leader + `<rect x="${r(box.x)}" y="${r(box.y)}" width="${r(box.w)}" height="${r(box.h)}" rx="${r(overlay.radius * k)}" fill="${overlay.fill}"/>` + blockText(b, overlay.style, box.x + padX, box.y + padY, "left");
}

/** Quadratic curve with a filled head; the shaft stops at the head's base so it never pokes through. */
export function arrowGeometry(overlay: Pick<ArrowOverlay, "x1" | "y1" | "x2" | "y2" | "bend" | "width">, k: number, W: number, H: number) {
  const x1 = overlay.x1 * W;
  const y1 = overlay.y1 * H;
  const x2 = overlay.x2 * W;
  const y2 = overlay.y2 * H;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy) || 1;
  const cx = (x1 + x2) / 2 + (-dy / length) * overlay.bend * length * 0.35;
  const cy = (y1 + y2) / 2 + (dx / length) * overlay.bend * length * 0.35;
  const width = Math.max(1, overlay.width * k);
  const head = Math.min(width * 3.2, length * 0.6);
  const tx = x2 - cx;
  const ty = y2 - cy;
  const tl = Math.hypot(tx, ty) || 1;
  const ux = tx / tl;
  const uy = ty / tl;
  const base = { x: x2 - ux * head, y: y2 - uy * head };
  return { x1, y1, x2, y2, cx, cy, width, head, ux, uy, base };
}

function arrow(overlay: ArrowOverlay, k: number, W: number, H: number): string {
  const g = arrowGeometry(overlay, k, W, H);
  const half = g.head * 0.62;
  const left = { x: g.base.x - g.uy * half, y: g.base.y + g.ux * half };
  const right = { x: g.base.x + g.uy * half, y: g.base.y - g.ux * half };
  // Pull the control point toward the base so the shaft meets the head smoothly.
  const ctrl = { x: (g.cx + g.base.x) / 2, y: (g.cy + g.base.y) / 2 };
  return (
    `<path d="M${r(g.x1)} ${r(g.y1)}Q${r(ctrl.x)} ${r(ctrl.y)} ${r(g.base.x + g.ux * 1)} ${r(g.base.y + g.uy * 1)}" fill="none" stroke="${overlay.color}" stroke-width="${r(g.width)}" stroke-linecap="round"/>` +
    `<path d="M${r(g.x2)} ${r(g.y2)}L${r(left.x)} ${r(left.y)}L${r(right.x)} ${r(right.y)}Z" fill="${overlay.color}" stroke="${overlay.color}" stroke-width="${r(g.width * 0.3)}" stroke-linejoin="round"/>`
  );
}

function dot(overlay: DotOverlay, k: number, W: number, point: (at: string) => { x: number; y: number } | null, background: string, show: (text: string) => string): string {
  const p = point(overlay.at);
  if (!p) return "";
  const radius = Math.max(1, overlay.radius * k);
  let out = `<circle cx="${r(p.x)}" cy="${r(p.y)}" r="${r(radius)}" fill="${overlay.color}" stroke="${background}" stroke-width="${r(radius * 0.35)}"/>`;
  const label = show(overlay.label).trim();
  if (label) {
    const size = overlay.labelStyle.size * k;
    const text = overlay.labelStyle.uppercase ? label.toUpperCase() : label;
    const nearRight = p.x > W * 0.75;
    out += `<text x="${r(nearRight ? p.x - radius * 1.6 : p.x + radius * 1.6)}" y="${r(p.y - radius * 1.6)}" text-anchor="${nearRight ? "end" : "start"}" ${textAttrs(overlay.labelStyle, size)}>${xml(text)}</text>`;
  }
  return out;
}

function image(overlay: ImageOverlay, W: number, H: number, imageHref?: (assetId: string) => string | null): string {
  const href = imageHref?.(overlay.assetId);
  const width = overlay.w * W;
  const height = width / overlay.aspect;
  const x = overlay.x * W;
  const y = overlay.y * H;
  if (!href) return `<rect x="${r(x)}" y="${r(y)}" width="${r(width)}" height="${r(height)}" fill="#000" fill-opacity="0"/>`;
  return `<image href="${xml(href)}" x="${r(x)}" y="${r(y)}" width="${r(width)}" height="${r(height)}" opacity="${overlay.opacity}" preserveAspectRatio="xMidYMid meet"/>`;
}

export { fmtPrice };
