/**
 * Starter templates. Stored as data in chart_templates and seeded CREATE-ONLY by slug: once a row
 * exists it belongs to the team and code never overwrites it. All sizes are design units at 2000×1000.
 */
import { DEFAULT_THEME, normalizeSpec, normalizeStyle, type ChartSpec, type StyleSpec, type TemplateCategory } from "./spec";

export type StarterTemplate = {
  slug: string;
  name: string;
  description: string;
  category: TemplateCategory;
  sortOrder: number;
  style: StyleSpec;
};

const DESIGN = { w: 2000, h: 1000 };

const midnight: StyleSpec = normalizeStyle({
  chartType: "area",
  design: DESIGN,
  theme: {
    ...DEFAULT_THEME,
    background: "#0b1220",
    background2: "#14213d",
    title: { size: 64, weight: 800, color: "#ffffff", uppercase: false },
    subtitle: { size: 36, weight: 400, color: "rgba(255,255,255,0.72)", uppercase: false },
    axis: { size: 30, weight: 400, color: "rgba(255,255,255,0.72)", uppercase: false },
    footer: { size: 24, weight: 400, color: "rgba(255,255,255,0.55)", uppercase: false },
    line: { color: "#38bdf8", width: 7 },
    area: { color: "#38bdf8", opacity: 0.45 },
    grid: { color: "rgba(255,255,255,0.12)", width: 2, dashed: false, show: true },
  },
  overlays: [
    {
      id: "headline",
      type: "headline",
      text: "{ticker} UP {gain}",
      x: 0.06,
      y: 0.22,
      style: { size: 104, weight: 800, color: "#0b1220", uppercase: true },
      align: "left",
      box: { fill: "#facc15", radius: 18, padX: 40, padY: 26 },
    },
    { id: "arrow", type: "arrow", x1: 0.3, y1: 0.8, x2: 0.72, y2: 0.42, bend: 0.35, color: "#ffffff", width: 14 },
    { id: "end-dot", type: "dot", at: "end", color: "#facc15", radius: 16, label: "", labelStyle: { size: 34, weight: 700, color: "#ffffff", uppercase: false } },
  ],
  subtitle: "{from} to {to}",
  footerLeft: "Source: {source}. Past performance does not guarantee future results.",
});

const green: StyleSpec = normalizeStyle({
  chartType: "line",
  design: DESIGN,
  theme: {
    ...DEFAULT_THEME,
    background: "#052e16",
    background2: "#0f3d22",
    title: { size: 64, weight: 800, color: "#ffffff", uppercase: true },
    subtitle: { size: 36, weight: 600, color: "#bbf7d0", uppercase: false },
    axis: { size: 30, weight: 400, color: "rgba(255,255,255,0.7)", uppercase: false },
    footer: { size: 24, weight: 400, color: "rgba(255,255,255,0.55)", uppercase: false },
    line: { color: "#4ade80", width: 9 },
    grid: { color: "rgba(255,255,255,0.1)", width: 2, dashed: true, show: true },
  },
  overlays: [
    {
      id: "headline",
      type: "headline",
      text: "UP {gainRounded}",
      x: 0.06,
      y: 0.24,
      style: { size: 128, weight: 800, color: "#052e16", uppercase: true },
      align: "left",
      box: { fill: "#ffffff", radius: 22, padX: 44, padY: 28 },
    },
    {
      id: "buy",
      type: "callout",
      text: "Here: {start}",
      x: 0.12,
      y: 0.66,
      style: { size: 38, weight: 700, color: "#052e16", uppercase: false },
      fill: "#bbf7d0",
      radius: 12,
      pointAt: "start",
      lineColor: "#bbf7d0",
    },
    { id: "now", type: "dot", at: "end", color: "#ffffff", radius: 15, label: "{end}", labelStyle: { size: 40, weight: 800, color: "#ffffff", uppercase: false } },
  ],
  subtitle: "{name}",
  footerLeft: "Source: {source}",
});

const clean: StyleSpec = normalizeStyle({
  chartType: "line",
  design: DESIGN,
  theme: {
    ...DEFAULT_THEME,
    title: { size: 60, weight: 700, color: "#0b1220", uppercase: false },
    subtitle: { size: 36, weight: 400, color: "#3e4a5c", uppercase: false },
    line: { color: "#1e3a8a", width: 6 },
    titleAccent: "#1d4ed8",
  },
  overlays: [{ id: "end-dot", type: "dot", at: "end", color: "#1e3a8a", radius: 12, label: "{end}", labelStyle: { size: 34, weight: 700, color: "#1e3a8a", uppercase: false } }],
  subtitle: "{gain} from {from} to {to}",
  footerLeft: "Source: {source}",
});

const card: StyleSpec = normalizeStyle({
  chartType: "area",
  design: DESIGN,
  theme: {
    ...DEFAULT_THEME,
    background: "#f5f6f8",
    title: { size: 60, weight: 800, color: "#0b1220", uppercase: false },
    subtitle: { size: 36, weight: 400, color: "#3e4a5c", uppercase: false },
    line: { color: "#2563eb", width: 6 },
    area: { color: "#3b82f6", opacity: 0.3 },
    plot: { fill: "#ffffff", radius: 28 },
    grid: { color: "#eceff3", width: 2, dashed: false, show: true },
  },
  overlays: [
    {
      id: "headline",
      type: "headline",
      text: "{gain} in {span}",
      x: 0.07,
      y: 0.27,
      style: { size: 72, weight: 800, color: "#ffffff", uppercase: false },
      align: "left",
      box: { fill: "#1d4ed8", radius: 14, padX: 30, padY: 20 },
    },
  ],
  subtitle: "{name} · {cagr} a year",
  footerLeft: "Source: {source}",
});

export const STARTER_TEMPLATES: readonly StarterTemplate[] = [
  { slug: "promo-midnight", name: "Promo · Midnight", description: "Dark promo chart with a yellow gain box, arrow and end dot.", category: "PROMO", sortOrder: 10, style: midnight },
  { slug: "promo-green", name: "Promo · Green light", description: "Bold green line with a big rounded-down gain and a buy-point callout.", category: "PROMO", sortOrder: 20, style: green },
  { slug: "publication-clean", name: "Publication · Clean", description: "White newsletter chart with a navy line and the last price.", category: "PUBLICATION", sortOrder: 30, style: clean },
  { slug: "publication-card", name: "Publication · Card", description: "Soft grey page, white plot card, blue area and a gain box.", category: "PUBLICATION", sortOrder: 40, style: card },
];

/** A fresh chart for the editor: first starter, AAPL, 1 year, daily, promo size. */
export function defaultSpec(today: string, style: StyleSpec = midnight, templateId: string | null = null): ChartSpec {
  return normalizeSpec({ ...style, templateId, title: "{name} ({ticker})", size: { preset: "promo" }, data: { symbol: "AAPL", period: "1Y", interval: "day", adjust: "split" } }, today);
}
