import { Prisma, appendOrgAudit, tenantDb } from "@pubcommand/db";
import { teachBrain } from "@/features/brain/teach";
import { BULK_CONCURRENCY, mapLimit, type BulkRow } from "../../../../../modules/charts/bulk";
import { renderChart, type ChartMeta } from "../../../../../modules/charts/render";
import { applyStyle, normalizeSpec, normalizeStyle, type ChartSpec, type HeadlineOverlay, type StyleSpec } from "../../../../../modules/charts/spec";
import { STARTER_TEMPLATES, defaultSpec } from "../../../../../modules/charts/templates";
import { claimPattern, displayText, isOverridden, literalFigures, type SeriesStats } from "../../../../../modules/charts/tokens";
import { loadSeries, packBars, rangeOf, todayIso, unpackBars, type LoadedSeries } from "./market";

export type Scope = { organizationId: string; brandId: string; brandName: string; actorId: string | null };

// ----------------------------------------------------------------------------- templates

/** Create any missing starter by slug. Never touches an existing (or deleted) row. */
export async function ensureStarterTemplates(organizationId: string): Promise<void> {
  const db = tenantDb(organizationId);
  const existing = await db.chartTemplate.findMany({ where: { slug: { in: STARTER_TEMPLATES.map((t) => t.slug) } }, select: { slug: true } });
  const have = new Set(existing.map((row) => row.slug));
  for (const starter of STARTER_TEMPLATES) {
    if (have.has(starter.slug)) continue;
    try {
      await db.chartTemplate.create({
        data: {
          organizationId,
          slug: starter.slug,
          name: starter.name,
          description: starter.description,
          category: starter.category,
          style: starter.style as unknown as Prisma.InputJsonValue,
          locked: true,
          sortOrder: starter.sortOrder,
        },
      });
    } catch {
      // A parallel request created it first.
    }
  }
}

export type TemplateRow = { id: string; slug: string | null; name: string; description: string; category: string; locked: boolean; style: StyleSpec; createdById: string | null };

export async function listTemplates(organizationId: string): Promise<TemplateRow[]> {
  await ensureStarterTemplates(organizationId);
  const rows = await tenantDb(organizationId).chartTemplate.findMany({
    where: { deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((row) => ({ id: row.id, slug: row.slug, name: row.name, description: row.description, category: row.category, locked: row.locked, style: normalizeStyle(row.style), createdById: row.createdById }));
}

// ----------------------------------------------------------------------------- charts

export function firstHeadline(spec: ChartSpec): HeadlineOverlay | null {
  return spec.overlays.find((overlay): overlay is HeadlineOverlay => overlay.type === "headline") ?? null;
}

export function metaOf(series: Pick<LoadedSeries, "symbol" | "name" | "source" | "unit">): ChartMeta {
  return { ticker: series.symbol, name: series.name, source: series.source, unit: series.unit };
}

type Built = { spec: ChartSpec; series: LoadedSeries; stats: SeriesStats | null; tokens: Record<string, string>; headline: string; overridden: boolean };

/** Fetch the data again on the server and mark the headline override. Numbers never come from the client. */
export async function buildChart(rawSpec: unknown): Promise<{ ok: true; built: Built } | { ok: false; error: string }> {
  const spec = normalizeSpec(rawSpec, todayIso());
  const loaded = await loadSeries(spec.data);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  for (const overlay of spec.overlays) if (overlay.type === "headline") overlay.overridden = isOverridden(overlay.text);
  const { stats, tokens } = renderChart({ spec, bars: loaded.series.bars, meta: metaOf(loaded.series) });
  const head = firstHeadline(spec);
  return {
    ok: true,
    built: {
      spec,
      series: loaded.series,
      stats,
      tokens,
      headline: head ? displayText(head.text, tokens, stats?.gainPct, spec.lossWord) : "",
      overridden: spec.overlays.some((overlay) => overlay.type === "headline" && overlay.overridden),
    },
  };
}

function ledgerNote(input: { id: string; built: Built; brandName: string; name: string }) {
  const { built } = input;
  const { spec, series, stats, tokens } = built;
  const head = firstHeadline(spec);
  const range = rangeOf(spec.data);
  const lines = [
    `Chart **${input.name || series.symbol}** for ${input.brandName}.`,
    "",
    `- Symbol: ${series.symbol}${series.name && series.name !== series.symbol ? ` (${series.name})` : ""}`,
    `- Period: ${spec.data.period === "CUSTOM" ? `${range.from} to ${range.to}` : spec.data.period} · ${spec.data.interval} bars · ${spec.data.adjust === "total" ? "dividends reinvested" : "split-adjusted prices"}`,
    `- Data: ${series.source}, ${stats ? `${stats.firstDate} to ${stats.lastDate}` : "no bars"} (${series.bars.length} bars stored with the chart)`,
    stats ? `- Computed gain: ${tokens.gain} (rounded down: ${tokens.gainRounded})${tokens.cagr ? ` · CAGR ${tokens.cagr}` : ""}` : "- Computed gain: none",
    stats ? `- Start ${tokens.start} → end ${tokens.end}` : "",
    head ? `- Headline as shown: "${built.headline}"` : "- No headline",
    head ? `- Claim pattern: ${claimPattern(head.text)}` : "",
    `- Headline overridden: ${built.overridden ? `YES, typed figure(s) ${literalFigures(head?.text ?? "").join(", ")} instead of the data` : "no"}`,
    `- Size: ${spec.size.w}×${spec.size.h} (${spec.size.preset})`,
    "",
    `Source ref: chart:${input.id}`,
  ];
  return lines.filter((line) => line !== "").join("\n");
}

export async function saveChart(
  scope: Scope,
  input: { spec: unknown; chartId?: string | null; projectId?: string | null; name?: string; batchId?: string | null; via?: "ui" | "bulk" },
): Promise<{ ok: true; id: string; overridden: boolean } | { ok: false; error: string }> {
  const built = await buildChart(input.spec);
  if (!built.ok) return built;
  const db = tenantDb(scope.organizationId);
  const { spec, series, stats, tokens } = built.built;
  let projectId: string | null = null;
  if (input.projectId) {
    const project = await db.chartProject.findFirst({ where: { id: input.projectId, brandId: scope.brandId, deletedAt: null }, select: { id: true } });
    if (!project) return { ok: false, error: "That project no longer exists." };
    projectId = project.id;
  }
  const name = (input.name ?? "").trim().slice(0, 200) || displayText(spec.title, tokens, stats?.gainPct).slice(0, 200) || series.symbol;
  const data = {
    name,
    symbol: series.symbol,
    spec: spec as unknown as Prisma.InputJsonValue,
    bars: packBars(series.bars),
    stats: stats ? (stats as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
    tokens,
    source: series.source,
    seriesName: series.name,
    unit: series.unit,
    warnings: series.warnings,
    headline: built.built.headline.slice(0, 400),
    headlineOverridden: built.built.overridden,
    templateId: spec.templateId,
  };
  let id: string;
  const existing = input.chartId
    ? await db.chart.findFirst({ where: { id: input.chartId, brandId: scope.brandId, deletedAt: null }, select: { id: true, projectId: true } })
    : null;
  if (existing) {
    await db.chart.updateMany({ where: { id: existing.id }, data: { ...data, projectId: input.projectId === undefined ? existing.projectId : projectId } });
    id = existing.id;
  } else {
    const created = await db.chart.create({
      data: {
        organizationId: scope.organizationId,
        brandId: scope.brandId,
        projectId,
        batchId: input.batchId ?? null,
        createdById: scope.actorId,
        createdVia: input.via ?? "ui",
        ...data,
      },
    });
    id = created.id;
    if (spec.templateId) await db.chartTemplate.updateMany({ where: { id: spec.templateId }, data: { usageCount: { increment: 1 } } });
  }
  await appendOrgAudit(scope.organizationId, { actorId: scope.actorId, action: existing ? "chart.updated" : "chart.created", targetType: "chart", targetId: id });
  if (input.via !== "bulk") {
    await teachBrain({
      organizationId: scope.organizationId,
      brandId: scope.brandId,
      sourceRef: `chart:${id}`,
      title: `Chart: ${name}`.slice(0, 180),
      body: ledgerNote({ id, built: built.built, brandName: scope.brandName, name }),
      folder: "ChartBuilder",
      source: "charts",
      actorId: scope.actorId,
    });
  }
  return { ok: true, id, overridden: built.built.overridden };
}

export type StoredChart = Awaited<ReturnType<typeof loadChart>>;

export async function loadChart(organizationId: string, brandId: string, chartId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(chartId)) return null;
  const row = await tenantDb(organizationId).chart.findFirst({ where: { id: chartId, brandId, deletedAt: null } });
  if (!row) return null;
  return {
    ...row,
    spec: normalizeSpec(row.spec, todayIso()),
    barsList: unpackBars(row.bars),
    meta: { ticker: row.symbol, name: row.seriesName, source: row.source, unit: row.unit } satisfies ChartMeta,
    warningsList: Array.isArray(row.warnings) ? (row.warnings as unknown[]).filter((w): w is string => typeof w === "string") : [],
  };
}

/** data: URIs for every image on a spec, for server-side rendering. */
export async function assetDataUris(organizationId: string, specs: ChartSpec[]): Promise<(assetId: string) => string | null> {
  const ids = [...new Set(specs.flatMap((spec) => spec.overlays.flatMap((overlay) => (overlay.type === "image" ? [overlay.assetId] : []))))];
  if (!ids.length) return () => null;
  const rows = await tenantDb(organizationId).chartAsset.findMany({ where: { id: { in: ids } }, select: { id: true, mimeType: true, data: true } });
  const map = new Map(rows.map((row) => [row.id, `data:${row.mimeType};base64,${Buffer.from(row.data).toString("base64")}`]));
  return (assetId) => map.get(assetId) ?? null;
}

// ----------------------------------------------------------------------------- bulk

export type BulkDesign = { templateId: string | null; style: StyleSpec; size: ChartSpec["size"] };

export function bulkSpec(row: BulkRow, design: BulkDesign): ChartSpec {
  const base = defaultSpec(todayIso(), design.style, design.templateId);
  const spec = applyStyle({ ...base, size: design.size }, design.style, design.templateId);
  spec.data = { ...spec.data, symbol: row.symbol, period: row.period, from: row.from ?? spec.data.from, to: row.to ?? spec.data.to, interval: row.interval };
  if (row.title) spec.title = row.title;
  if (row.headline) {
    const head = firstHeadline(spec);
    if (head) head.text = row.headline;
    else
      spec.overlays.unshift({
        id: "headline",
        type: "headline",
        text: row.headline,
        x: 0.06,
        y: 0.24,
        style: { size: 104, weight: 800, color: "#0b1220", uppercase: true },
        align: "left",
        box: { fill: "#facc15", radius: 18, padX: 40, padY: 26 },
        overridden: false,
      });
  }
  return spec;
}

export const STALE_MS = 20 * 60 * 1000;

export async function runBulk(scope: Scope, batchId: string): Promise<void> {
  const db = tenantDb(scope.organizationId);
  try {
    const batch = await db.chartBatch.findFirst({ where: { id: batchId } });
    if (!batch) return;
    const rows = batch.rows as unknown as BulkRow[];
    const design = batch.design as unknown as BulkDesign;
    design.style = normalizeStyle(design.style);
    await db.chartBatch.updateMany({ where: { id: batchId }, data: { status: "RUNNING" } });
    const errors: string[] = [];
    const results = await mapLimit(rows, BULK_CONCURRENCY, async (row) => {
      const saved = await saveChart(scope, { spec: bulkSpec(row, design), batchId, name: row.title ?? undefined, via: "bulk" }).catch((error: unknown) => ({ ok: false as const, error: String(error) }));
      if (saved.ok) await db.chartBatch.updateMany({ where: { id: batchId }, data: { done: { increment: 1 } } });
      else {
        errors.push(`Line ${row.line} (${row.symbol}): ${saved.error}`);
        await db.chartBatch.updateMany({ where: { id: batchId }, data: { failed: { increment: 1 }, errors } });
      }
      return saved.ok ? row : null;
    });
    const made = results.filter(Boolean).length;
    await db.chartBatch.updateMany({ where: { id: batchId }, data: { status: made ? "DONE" : "FAILED", errors } });
    await appendOrgAudit(scope.organizationId, { actorId: scope.actorId, action: "chart.bulk.finished", targetType: "chart_batch", targetId: batchId });
    if (made) {
      const charts = await db.chart.findMany({ where: { batchId }, select: { symbol: true, tokens: true, headlineOverridden: true }, orderBy: { createdAt: "asc" } });
      const body = [
        `Bulk run of ${made} chart${made === 1 ? "" : "s"} for ${scope.brandName}.`,
        "",
        ...charts.map((chart) => {
          const tokens = (chart.tokens ?? {}) as Record<string, string>;
          return `- ${chart.symbol}: ${tokens.gain ?? "n/a"}${tokens.cagr ? ` (CAGR ${tokens.cagr})` : ""}${chart.headlineOverridden ? " · headline overridden" : ""}`;
        }),
        errors.length ? `\nFailed: ${errors.length}` : "",
        "",
        `Source ref: chart-batch:${batchId}`,
      ].join("\n");
      await teachBrain({ organizationId: scope.organizationId, brandId: scope.brandId, sourceRef: `chart-batch:${batchId}`, title: `Chart bulk run (${made} charts)`, body, folder: "ChartBuilder", source: "charts", actorId: scope.actorId });
    }
  } catch (error) {
    console.error("[charts] bulk failed", batchId, error);
    await db.chartBatch.updateMany({ where: { id: batchId }, data: { status: "FAILED", errors: [String(error)] } }).catch(() => undefined);
  }
}
