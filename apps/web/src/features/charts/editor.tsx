"use client";

import { Button, Input, Label, Textarea } from "@pubcommand/ui";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type PointerEvent as ReactPointerEvent } from "react";
import { barIndex, renderChart } from "../../../../../modules/charts/render";
import {
  CHART_PERIODS,
  SIZE_PRESETS,
  applyStyle,
  normalizeOverlay,
  type ChartSpec,
  type HeadlineOverlay,
  type Overlay,
  type SizePreset,
  type StyleSpec,
} from "../../../../../modules/charts/spec";
import { TOKEN_HELP, isoDate, literalFigures, type ChartBar } from "../../../../../modules/charts/tokens";
import type { SaveResult } from "./actions";
import type { SeriesResult } from "./market";

export type EditorSeries = { symbol: string; name: string; source: string; unit: "$" | ""; warnings: string[]; bars: ChartBar[] };

export type EditorTemplate = { id: string; name: string; category: string; style: StyleSpec };

export type EditorActions = {
  fetchSeries: (data: unknown) => Promise<SeriesResult>;
  save: (input: { spec: unknown; chartId?: string | null; projectId?: string | null; name?: string; asCopy?: boolean }) => Promise<SaveResult>;
  createProject: (input: { name: string }) => Promise<{ ok: true; id: string; name: string } | { ok: false; error: string }>;
  saveTemplate: (input: { name: string; category: string; spec: unknown }) => Promise<{ ok: true; id: string } | { ok: false; error: string }>;
  uploadImage: (form: FormData) => Promise<{ ok: true; id: string; aspect: number } | { ok: false; error: string }>;
};

type Props = {
  initialSpec: ChartSpec;
  initialSeries: EditorSeries | null;
  initialError: string | null;
  chartId: string | null;
  chartName: string;
  projectId: string | null;
  templates: EditorTemplate[];
  projects: Array<{ id: string; name: string }>;
  marketNote: string | null;
  actions: EditorActions;
};

const INTERVAL_LABELS: Record<string, string> = { day: "Daily", week: "Weekly", month: "Monthly", hour: "Hourly", "5min": "5-minute" };
const TOKENS = ["gain", "gainRounded", "start", "end", "cagr", "span", "ticker", "name"] as const;

let overlaySeq = 0;
function newId(type: string) {
  overlaySeq += 1;
  return `${type}-${Date.now().toString(36)}-${overlaySeq}`;
}

function templateFor(type: Overlay["type"], spec: ChartSpec): Overlay | null {
  const dark = /^#0|^#1|^rgb\(\s*[0-4]?\d\s*,/.test(spec.theme.background);
  const ink = dark ? "#ffffff" : "#0b1220";
  const id = newId(type);
  switch (type) {
    case "headline":
      return normalizeOverlay({ id, type, text: "UP {gain}", x: 0.06, y: 0.24, style: { size: 104, weight: 800, color: "#0b1220", uppercase: true }, box: { fill: "#facc15", radius: 18, padX: 40, padY: 26 } });
    case "text":
      return normalizeOverlay({ id, type, text: "Your text", x: 0.4, y: 0.5, style: { size: 56, weight: 700, color: ink } });
    case "callout":
      return normalizeOverlay({ id, type, text: "Bought here", x: 0.2, y: 0.62, pointAt: "start", fill: dark ? "#ffffff" : "#0b1220", lineColor: dark ? "#ffffff" : "#0b1220", style: { size: 40, weight: 700, color: dark ? "#0b1220" : "#ffffff" } });
    case "arrow":
      return normalizeOverlay({ id, type, x1: 0.3, y1: 0.78, x2: 0.7, y2: 0.4, bend: 0.35, color: dark ? "#ffffff" : "#1d4ed8", width: 14 });
    case "dot":
      return normalizeOverlay({ id, type, at: "end", color: dark ? "#facc15" : "#1d4ed8", radius: 14, label: "{end}", labelStyle: { size: 36, weight: 700, color: ink } });
    default:
      return null;
  }
}

function label(overlay: Overlay): string {
  if (overlay.type === "headline" || overlay.type === "text" || overlay.type === "callout") return `${overlay.type}: ${overlay.text.slice(0, 24) || "(empty)"}`;
  if (overlay.type === "dot") return `dot at ${overlay.at}`;
  if (overlay.type === "image") return "image";
  return "arrow";
}

type Drag =
  | { kind: "move"; id: string; startX: number; startY: number; origin: Overlay; rect: DOMRect }
  | { kind: "end"; id: string; end: 1 | 2; rect: DOMRect };

export function ChartEditor(props: Props) {
  const [spec, setSpec] = useState<ChartSpec>(props.initialSpec);
  const [series, setSeries] = useState<EditorSeries | null>(props.initialSeries);
  const [seriesError, setSeriesError] = useState<string | null>(props.initialError);
  const [selected, setSelected] = useState<string | null>(null);
  const [chartId, setChartId] = useState<string | null>(props.chartId);
  const [chartName, setChartName] = useState(props.chartName);
  const [projectId, setProjectId] = useState<string | null>(props.projectId);
  const [projects, setProjects] = useState(props.projects);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();
  const previewRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [symbolDraft, setSymbolDraft] = useState(props.initialSpec.data.symbol);

  const meta = useMemo(() => (series ? { ticker: series.symbol, name: series.name, source: series.source, unit: series.unit } : { ticker: spec.data.symbol, name: "", source: "", unit: "$" }), [series, spec.data.symbol]);
  const rendered = useMemo(
    () => renderChart({ spec, bars: series?.bars ?? [], meta, imageHref: (id) => `/charts/assets/${id}`, idPrefix: "edit" }),
    [spec, series, meta],
  );
  const headline = spec.overlays.find((overlay): overlay is HeadlineOverlay => overlay.type === "headline") ?? null;
  const typed = headline ? literalFigures(headline.text) : [];
  const selectedOverlay = spec.overlays.find((overlay) => overlay.id === selected) ?? null;

  const update = useCallback((change: (draft: ChartSpec) => void) => {
    setSpec((current) => {
      const next = structuredClone(current);
      change(next);
      return next;
    });
  }, []);

  const updateOverlay = useCallback(
    (id: string, change: (overlay: Overlay) => void) =>
      update((draft) => {
        const overlay = draft.overlays.find((item) => item.id === id);
        if (overlay) change(overlay);
      }),
    [update],
  );

  const load = useCallback(
    (data: ChartSpec["data"]) => {
      startLoading(async () => {
        const result = await props.actions.fetchSeries(data);
        if (result.ok) {
          setSeries({ ...result.series, bars: result.series.bars });
          setSeriesError(null);
        } else {
          setSeries(null);
          setSeriesError(result.error);
        }
      });
    },
    [props.actions],
  );

  const setData = (change: Partial<ChartSpec["data"]>, reload = true) => {
    const next = { ...spec.data, ...change };
    update((draft) => {
      draft.data = next;
    });
    if (reload) load(next);
  };

  // ----------------------------------------------------------------- dragging on the preview

  function svgRect(): DOMRect | null {
    return previewRef.current?.querySelector("svg")?.getBoundingClientRect() ?? null;
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const target = (event.target as Element).closest("[data-overlay-id]");
    const rect = svgRect();
    if (!target || !rect) {
      setSelected(null);
      return;
    }
    const id = target.getAttribute("data-overlay-id") ?? "";
    const origin = spec.overlays.find((overlay) => overlay.id === id);
    if (!origin) return;
    setSelected(id);
    drag.current = { kind: "move", id, startX: event.clientX, startY: event.clientY, origin: structuredClone(origin), rect };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function onHandleDown(event: ReactPointerEvent<HTMLButtonElement>, id: string, end: 1 | 2) {
    const rect = svgRect();
    if (!rect) return;
    setSelected(id);
    drag.current = { kind: "end", id, end, rect };
    previewRef.current?.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current) return;
    const rect = current.rect;
    const fx = (event.clientX - rect.left) / rect.width;
    const fy = (event.clientY - rect.top) / rect.height;
    const clamp = (v: number) => Math.min(1.2, Math.max(-0.2, v));
    if (current.kind === "end") {
      updateOverlay(current.id, (overlay) => {
        if (overlay.type !== "arrow") return;
        if (current.end === 1) Object.assign(overlay, { x1: clamp(fx), y1: clamp(fy) });
        else Object.assign(overlay, { x2: clamp(fx), y2: clamp(fy) });
      });
      return;
    }
    const dx = (event.clientX - current.startX) / rect.width;
    const dy = (event.clientY - current.startY) / rect.height;
    const origin = current.origin;
    updateOverlay(current.id, (overlay) => {
      if (overlay.type === "arrow" && origin.type === "arrow") {
        Object.assign(overlay, { x1: clamp(origin.x1 + dx), y1: clamp(origin.y1 + dy), x2: clamp(origin.x2 + dx), y2: clamp(origin.y2 + dy) });
      } else if (overlay.type === "dot") {
        const bars = series?.bars ?? [];
        if (bars.length < 2) return;
        const px = fx * spec.size.w;
        const { plot } = rendered.layout;
        const index = Math.round(((px - plot.x) / plot.w) * (bars.length - 1));
        const bar = bars[Math.min(bars.length - 1, Math.max(0, index))];
        if (bar) overlay.at = index <= 0 ? "start" : index >= bars.length - 1 ? "end" : isoDate(bar.t);
      } else if ("x" in overlay && "x" in origin) {
        overlay.x = clamp(origin.x + dx);
        overlay.y = clamp(origin.y + dy);
      }
    });
  }

  function onPointerUp() {
    drag.current = null;
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!selected || !(event.target instanceof Element) || event.target.closest("input,textarea,select")) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        update((draft) => {
          draft.overlays = draft.overlays.filter((overlay) => overlay.id !== selected);
        });
        setSelected(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, update]);

  // ----------------------------------------------------------------- saving and downloads

  function save(opts: { asCopy?: boolean; thenDownload?: string } = {}) {
    setNotice(null);
    startSaving(async () => {
      const result = await props.actions.save({ spec, chartId: opts.asCopy ? null : chartId, projectId, name: chartName, asCopy: opts.asCopy });
      if (!result.ok) {
        setNotice({ tone: "error", text: result.error });
        return;
      }
      setChartId(result.id);
      const url = new URL(window.location.href);
      url.searchParams.set("chart", result.id);
      window.history.replaceState(null, "", url.toString());
      if (opts.thenDownload) {
        window.location.href = `/charts/c/${result.id}/export?format=${opts.thenDownload}`;
        setNotice({ tone: "ok", text: `Saved. Downloading ${opts.thenDownload.toUpperCase()}…` });
      } else {
        setNotice({ tone: "ok", text: result.overridden ? "Saved. The headline override is recorded with the chart." : "Saved." });
      }
    });
  }

  async function newProject() {
    const name = window.prompt("Project name");
    if (!name) return;
    const result = await props.actions.createProject({ name });
    if (!result.ok) return setNotice({ tone: "error", text: result.error });
    setProjects((list) => [...list, { id: result.id, name: result.name }]);
    setProjectId(result.id);
  }

  async function saveAsTemplate() {
    const name = window.prompt("Template name");
    if (!name) return;
    const category = window.confirm("Is this a Promo template? (Cancel = Publication)") ? "PROMO" : "PUBLICATION";
    const result = await props.actions.saveTemplate({ name, category, spec });
    setNotice(result.ok ? { tone: "ok", text: `Template "${name}" saved for the team.` } : { tone: "error", text: result.error });
  }

  async function addImage(file: File) {
    const form = new FormData();
    form.set("file", file);
    const result = await props.actions.uploadImage(form);
    if (!result.ok) return setNotice({ tone: "error", text: result.error });
    const overlay = normalizeOverlay({ id: newId("image"), type: "image", assetId: result.id, x: 0.8, y: 0.05, w: 0.14, aspect: result.aspect, opacity: 1 });
    if (!overlay) return;
    update((draft) => {
      draft.overlays.push(overlay);
    });
    setSelected(overlay.id);
  }

  function addOverlay(type: Overlay["type"]) {
    const overlay = templateFor(type, spec);
    if (!overlay) return;
    update((draft) => {
      draft.overlays.push(overlay);
    });
    setSelected(overlay.id);
  }

  const isCsv = spec.data.symbol.trim().toUpperCase() === "CSV";
  const stats = rendered.stats;
  const tokens = rendered.tokens;

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
      <style>{`
        .pc-chart-preview svg { display:block; width:100%; height:auto; touch-action:none; }
        .pc-chart-preview [data-overlay-id] { cursor: move; }
      `}</style>

      {/* Preview first on phones, right column on desktop */}
      <section className="min-w-0 xl:order-2">
        <div className="sticky top-2 space-y-3">
          <div className="rounded-xl border border-line bg-white p-3">
            <div
              ref={previewRef}
              className="pc-chart-preview relative select-none overflow-hidden rounded-md border border-line"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              aria-label="Chart preview"
            >
              <div dangerouslySetInnerHTML={{ __html: rendered.svg }} />
              {spec.overlays.map((overlay) =>
                overlay.type === "arrow" && overlay.id === selected
                  ? ([1, 2] as const).map((end) => (
                      <button
                        key={`${overlay.id}-${end}`}
                        type="button"
                        aria-label={end === 1 ? "Arrow start" : "Arrow tip"}
                        onPointerDown={(event) => onHandleDown(event, overlay.id, end)}
                        className="absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-accent shadow"
                        style={{ left: `${(end === 1 ? overlay.x1 : overlay.x2) * 100}%`, top: `${(end === 1 ? overlay.y1 : overlay.y2) * 100}%` }}
                      />
                    ))
                  : null,
              )}
              {loading ? <div className="absolute inset-0 grid place-items-center bg-white/60 text-sm font-semibold text-muted">Loading data…</div> : null}
            </div>
            <p className="mt-2 text-xs text-muted">
              Drag text, boxes, arrows, dots and images on the chart. Select an arrow to move its ends. The download is drawn by the same renderer.
            </p>
          </div>

          {seriesError ? <p className="rounded-md border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm text-[#912018]">{seriesError}</p> : null}
          {series?.warnings.length ? (
            <ul className="rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
              {series.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}

          <div className="rounded-xl border border-line bg-white p-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1">
                <Label htmlFor="chart-name">Chart name</Label>
                <Input id="chart-name" value={chartName} maxLength={200} onChange={(event) => setChartName(event.target.value)} placeholder="Defaults to the title" />
              </div>
              <div className="min-w-0 flex-1">
                <Label htmlFor="chart-project">Project</Label>
                <div className="flex gap-2">
                  <select id="chart-project" className="pc-control min-w-0 flex-1" value={projectId ?? ""} onChange={(event) => setProjectId(event.target.value || null)}>
                    <option value="">No project</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                  <Button type="button" variant="secondary" onClick={newProject} aria-label="New project">
                    +
                  </Button>
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" onClick={() => save()} disabled={saving || !series}>
                {saving ? "Saving…" : chartId ? "Save" : "Save chart"}
              </Button>
              {chartId ? (
                <Button type="button" variant="secondary" onClick={() => save({ asCopy: true })} disabled={saving || !series}>
                  Save as copy
                </Button>
              ) : null}
              {(["png", "jpg", "svg", "pdf"] as const).map((format) => (
                <Button key={format} type="button" variant="secondary" onClick={() => save({ thenDownload: format })} disabled={saving || !series}>
                  {format.toUpperCase()}
                </Button>
              ))}
              <Button type="button" variant="ghost" onClick={saveAsTemplate}>
                Save as template
              </Button>
            </div>
            {notice ? <p className={`mt-2 text-sm ${notice.tone === "ok" ? "text-[#067647]" : "text-[#912018]"}`}>{notice.text}</p> : null}
            <p className="mt-2 text-xs text-muted">Downloads save the chart first, with the exact bars drawn, so every figure can be traced.</p>
          </div>
        </div>
      </section>

      <section className="min-w-0 space-y-4 xl:order-1">
        {props.marketNote ? <p className="rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">{props.marketNote}</p> : null}

        <Panel title="Data">
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setData({ symbol: symbolDraft.trim() || "AAPL" });
            }}
          >
            <div className="min-w-0 flex-1">
              <Label htmlFor="chart-symbol">Ticker</Label>
              <Input id="chart-symbol" value={symbolDraft} maxLength={60} onChange={(event) => setSymbolDraft(event.target.value)} placeholder="AMD, CPER/GLD, FRED:PCOPPUSDM or CSV" autoCapitalize="characters" />
            </div>
            <Button type="submit" className="self-end" disabled={loading}>
              Chart
            </Button>
          </form>
          <p className="mt-1 text-xs text-muted">A ticker, a ratio like CPER/GLD, a FRED series like FRED:DGS10, or CSV to paste your own data.</p>

          {isCsv ? (
            <div className="mt-3">
              <Label htmlFor="chart-csv">CSV data</Label>
              <Textarea id="chart-csv" rows={6} value={spec.data.csv} onChange={(event) => setData({ csv: event.target.value }, false)} placeholder={"date,close\n2024-01-02,100\n2024-02-01,104"} className="font-mono text-xs" />
              <div className="mt-2 flex flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={() => load(spec.data)}>
                  Use this data
                </Button>
                <label className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-line bg-white px-3 text-sm font-semibold">
                  Upload .csv
                  <input
                    type="file"
                    accept=".csv,.txt,text/csv"
                    className="sr-only"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      const text = (await file.text()).slice(0, 2_000_000);
                      setData({ csv: text });
                    }}
                  />
                </label>
              </div>
            </div>
          ) : null}

          <div className="mt-3">
            <span className="text-sm font-semibold text-ink">Period</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {CHART_PERIODS.map((period) => (
                <button
                  key={period}
                  type="button"
                  onClick={() => setData({ period })}
                  className={`min-h-9 rounded-md border px-2.5 text-xs font-semibold ${spec.data.period === period ? "border-accent bg-accent text-white" : "border-line bg-white text-ink"}`}
                >
                  {period === "CUSTOM" ? "Dates" : period}
                </button>
              ))}
            </div>
          </div>
          {spec.data.period === "CUSTOM" ? (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="chart-from">From</Label>
                <Input id="chart-from" type="date" value={spec.data.from} onChange={(event) => setData({ from: event.target.value }, false)} onBlur={() => load(spec.data)} />
              </div>
              <div>
                <Label htmlFor="chart-to">To</Label>
                <Input id="chart-to" type="date" value={spec.data.to} onChange={(event) => setData({ to: event.target.value }, false)} onBlur={() => load(spec.data)} />
              </div>
            </div>
          ) : null}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="chart-interval">Timeframe</Label>
              <select id="chart-interval" className="pc-control w-full" value={spec.data.interval} onChange={(event) => setData({ interval: event.target.value as ChartSpec["data"]["interval"] })}>
                {Object.entries(INTERVAL_LABELS).map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="chart-adjust">Prices</Label>
              <select id="chart-adjust" className="pc-control w-full" value={spec.data.adjust} onChange={(event) => setData({ adjust: event.target.value as "split" | "total" })}>
                <option value="split">Split-adjusted</option>
                <option value="total">With dividends</option>
              </select>
            </div>
          </div>
          {series ? (
            <p className="mt-2 text-xs text-muted">
              {series.bars.length.toLocaleString("en-US")} bars from {series.source}
              {series.name && series.name !== series.symbol ? ` · ${series.name}` : ""}
            </p>
          ) : null}
        </Panel>

        <Panel title="Design">
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <Label htmlFor="chart-template">Template</Label>
              <select
                id="chart-template"
                className="pc-control w-full"
                value={spec.templateId ?? ""}
                onChange={(event) => {
                  const template = props.templates.find((item) => item.id === event.target.value);
                  if (template) setSpec((current) => applyStyle(current, template.style, template.id));
                  setSelected(null);
                }}
              >
                {!spec.templateId ? <option value="">Custom</option> : null}
                {(["PROMO", "PUBLICATION"] as const).map((category) => (
                  <optgroup key={category} label={category === "PROMO" ? "Promo" : "Publication"}>
                    {props.templates
                      .filter((template) => template.category === category)
                      .map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="chart-size">Size</Label>
              <select
                id="chart-size"
                className="pc-control w-full"
                value={spec.size.preset}
                onChange={(event) =>
                  update((draft) => {
                    const preset = event.target.value as SizePreset;
                    const size = SIZE_PRESETS[preset];
                    if (size) draft.size = { preset, w: size.w, h: size.h };
                  })
                }
              >
                {(Object.keys(SIZE_PRESETS) as SizePreset[]).map((preset) => (
                  <option key={preset} value={preset}>
                    {SIZE_PRESETS[preset].label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="chart-type">Chart</Label>
              <select id="chart-type" className="pc-control w-full" value={spec.chartType} onChange={(event) => update((draft) => void (draft.chartType = event.target.value as ChartSpec["chartType"]))}>
                <option value="area">Area</option>
                <option value="line">Line</option>
                <option value="candle">Candles</option>
              </select>
            </div>
            <ColorField label="Line" value={spec.theme.line.color} onChange={(color) => update((draft) => void ((draft.theme.line.color = color), (draft.theme.area.color = color)))} />
            <ColorField label="Background" value={spec.theme.background} onChange={(color) => update((draft) => void ((draft.theme.background = color), (draft.theme.background2 = null)))} />
          </div>
          <div className="mt-3 space-y-2">
            <TextField id="chart-title" label="Title" value={spec.title} onChange={(value) => update((draft) => void (draft.title = value))} />
            <TextField id="chart-subtitle" label="Subtitle" value={spec.subtitle} onChange={(value) => update((draft) => void (draft.subtitle = value))} />
            <div className="grid grid-cols-2 gap-2">
              <TextField id="chart-footer-left" label="Footer left" value={spec.footerLeft} placeholder="Source: {source}" onChange={(value) => update((draft) => void (draft.footerLeft = value))} />
              <TextField id="chart-footer-right" label="Footer right" value={spec.footerRight} onChange={(value) => update((draft) => void (draft.footerRight = value))} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={spec.theme.startAtZero} onChange={(event) => update((draft) => void (draft.theme.startAtZero = event.target.checked))} />
              Start the price axis at zero
            </label>
          </div>
        </Panel>

        <Panel title="Headline">
          {headline ? (
            <>
              <Textarea
                aria-label="Headline text"
                rows={2}
                value={headline.text}
                onChange={(event) => updateOverlay(headline.id, (overlay) => void (overlay.type === "headline" && (overlay.text = event.target.value)))}
              />
              <div className="mt-2 flex flex-wrap gap-1">
                {TOKENS.map((token) => (
                  <button
                    key={token}
                    type="button"
                    title={TOKEN_HELP[token]}
                    onClick={() => updateOverlay(headline.id, (overlay) => void (overlay.type === "headline" && (overlay.text = `${overlay.text}{${token}}`)))}
                    className="min-h-8 rounded border border-line bg-canvas px-2 font-mono text-xs"
                  >
                    {`{${token}}`}
                  </button>
                ))}
              </div>
              <div className="mt-3 rounded-md border border-line bg-canvas px-3 py-2 text-sm" data-testid="data-says">
                <span className="font-semibold">Data says:</span>{" "}
                {stats ? (
                  <>
                    {tokens.gain} total · {tokens.gainRounded} rounded down{tokens.cagr ? ` · ${tokens.cagr} a year` : ""} · {tokens.start} → {tokens.end}
                  </>
                ) : (
                  "load data to see the figures"
                )}
              </div>
              {typed.length ? (
                <div className="mt-2 rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
                  Overridden: you typed {typed.join(", ")}. The chart keeps it, and the save records the override next to the computed figure.{" "}
                  <button type="button" className="font-semibold underline" onClick={() => updateOverlay(headline.id, (overlay) => void (overlay.type === "headline" && (overlay.text = "UP {gain}")))}>
                    Use the data
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <Button type="button" variant="secondary" onClick={() => addOverlay("headline")}>
              Add a headline
            </Button>
          )}
        </Panel>

        <Panel title="Annotations">
          <div className="flex flex-wrap gap-2">
            {(["text", "callout", "arrow", "dot"] as const).map((type) => (
              <Button key={type} type="button" variant="secondary" size="sm" onClick={() => addOverlay(type)}>
                + {type[0]?.toUpperCase()}
                {type.slice(1)}
              </Button>
            ))}
            <label className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-line bg-white px-3 text-sm font-semibold">
              + Image
              <input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={(event) => event.target.files?.[0] && addImage(event.target.files[0])} />
            </label>
          </div>
          <ul className="mt-3 divide-y divide-line rounded-md border border-line">
            {spec.overlays.map((overlay) => (
              <li key={overlay.id} className={`flex items-center gap-2 px-3 py-2 text-sm ${overlay.id === selected ? "bg-[#eef2ff]" : ""}`}>
                <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => setSelected(overlay.id)}>
                  {label(overlay)}
                </button>
                <button
                  type="button"
                  className="text-xs font-semibold text-[#b42318]"
                  onClick={() => {
                    update((draft) => void (draft.overlays = draft.overlays.filter((item) => item.id !== overlay.id)));
                    if (selected === overlay.id) setSelected(null);
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
            {spec.overlays.length === 0 ? <li className="px-3 py-2 text-sm text-muted">No annotations.</li> : null}
          </ul>
          {selectedOverlay ? <Inspector overlay={selectedOverlay} bars={series?.bars ?? []} onChange={(change) => updateOverlay(selectedOverlay.id, change)} /> : null}
        </Panel>
      </section>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">{title}</h2>
      {children}
    </div>
  );
}

function TextField({ id, label: text, value, onChange, placeholder }: { id: string; label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <div className="min-w-0">
      <Label htmlFor={id}>{text}</Label>
      <Input id={id} value={value} maxLength={200} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function toHex(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : /^#[0-9a-f]{3}$/i.test(value) ? `#${[...value.slice(1)].map((c) => c + c).join("")}` : "#ffffff";
}

function ColorField({ label: text, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
      <input type="color" value={toHex(value)} onChange={(event) => onChange(event.target.value)} className="h-9 w-11 rounded border border-line bg-white p-0.5" />
      {text}
    </label>
  );
}

function Inspector({ overlay, bars, onChange }: { overlay: Overlay; bars: ChartBar[]; onChange: (change: (overlay: Overlay) => void) => void }) {
  const set = <K extends string>(key: K, value: unknown) => onChange((o) => void ((o as unknown as Record<string, unknown>)[key] = value));
  const where = (value: string) => {
    const index = barIndex(bars, value);
    return index >= 0 && bars[index] ? isoDate(bars[index].t) : value;
  };
  return (
    <div className="mt-3 space-y-2 rounded-md border border-line bg-canvas p-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">Selected {overlay.type}</p>
      {"text" in overlay ? <Textarea aria-label="Text" rows={2} value={overlay.text} onChange={(event) => set("text", event.target.value)} /> : null}
      {"style" in overlay ? (
        <div className="grid grid-cols-2 gap-2">
          <ColorField label="Text" value={overlay.style.color} onChange={(color) => onChange((o) => void ("style" in o && (o.style.color = color)))} />
          <label className="text-sm">
            Size
            <input type="range" min={16} max={220} value={overlay.style.size} onChange={(event) => onChange((o) => void ("style" in o && (o.style.size = Number(event.target.value))))} className="w-full" />
          </label>
        </div>
      ) : null}
      {overlay.type === "headline" ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!overlay.box} onChange={(event) => set("box", event.target.checked ? { fill: "#facc15", radius: 18, padX: 40, padY: 26 } : null)} />
          Box
          {overlay.box ? <ColorField label="Box color" value={overlay.box.fill} onChange={(color) => onChange((o) => void (o.type === "headline" && o.box && (o.box.fill = color)))} /> : null}
        </label>
      ) : null}
      {overlay.type === "callout" ? (
        <div className="grid grid-cols-2 gap-2">
          <ColorField label="Box" value={overlay.fill} onChange={(color) => set("fill", color)} />
          <label className="text-sm">
            Points at
            <select className="pc-control w-full" value={overlay.pointAt ?? ""} onChange={(event) => set("pointAt", event.target.value || null)}>
              <option value="">Nothing</option>
              <option value="start">First bar</option>
              <option value="end">Last bar</option>
              <option value="high">High</option>
              <option value="low">Low</option>
            </select>
          </label>
        </div>
      ) : null}
      {overlay.type === "arrow" ? (
        <div className="grid grid-cols-2 gap-2">
          <ColorField label="Color" value={overlay.color} onChange={(color) => set("color", color)} />
          <label className="text-sm">
            Curve
            <input type="range" min={-100} max={100} value={Math.round(overlay.bend * 100)} onChange={(event) => set("bend", Number(event.target.value) / 100)} className="w-full" />
          </label>
          <label className="col-span-2 text-sm">
            Width
            <input type="range" min={2} max={40} value={overlay.width} onChange={(event) => set("width", Number(event.target.value))} className="w-full" />
          </label>
        </div>
      ) : null}
      {overlay.type === "dot" ? (
        <div className="grid grid-cols-2 gap-2">
          <ColorField label="Color" value={overlay.color} onChange={(color) => set("color", color)} />
          <label className="text-sm">
            At
            <select className="pc-control w-full" value={["start", "end", "high", "low"].includes(overlay.at) ? overlay.at : "date"} onChange={(event) => set("at", event.target.value === "date" ? where(overlay.at) : event.target.value)}>
              <option value="start">First bar</option>
              <option value="end">Last bar</option>
              <option value="high">High</option>
              <option value="low">Low</option>
              <option value="date">{["start", "end", "high", "low"].includes(overlay.at) ? "A date (drag it)" : overlay.at}</option>
            </select>
          </label>
          <div className="col-span-2">
            <Label htmlFor="dot-label">Label</Label>
            <Input id="dot-label" value={overlay.label} maxLength={80} onChange={(event) => set("label", event.target.value)} placeholder="{end}" />
          </div>
        </div>
      ) : null}
      {overlay.type === "image" ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm">
            Width
            <input type="range" min={2} max={60} value={Math.round(overlay.w * 100)} onChange={(event) => set("w", Number(event.target.value) / 100)} className="w-full" />
          </label>
          <label className="text-sm">
            Opacity
            <input type="range" min={10} max={100} value={Math.round(overlay.opacity * 100)} onChange={(event) => set("opacity", Number(event.target.value) / 100)} className="w-full" />
          </label>
        </div>
      ) : null}
    </div>
  );
}
