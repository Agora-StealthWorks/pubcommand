import { tenantDb } from "@pubcommand/db";
import { API_SCOPES } from "../../../../../../../modules/charts/api-keys";
import { botSpec } from "../../../../../../../modules/charts/bot";
import { CHART_PERIODS, CHART_TYPES, COMPARE_MODES, INTERVALS, MAX_COMPARE, PERF_COLORS, SIZE_PRESETS } from "../../../../../../../modules/charts/spec";
import { TOKEN_HELP } from "../../../../../../../modules/charts/tokens";
import { CHART_JSON_SELECT, apiError, apiJson, chartJson, findTemplate, readJson, templatesFor, withApi } from "@/features/charts/api";
import { todayIso } from "@/features/charts/market";
import { saveChart } from "@/features/charts/server";

export const dynamic = "force-dynamic";

/** The cheat sheet: what a bot can send. Any valid key. */
export const GET = withApi(null, async (ctx) =>
  apiJson(200, {
    brand: ctx.brandName,
    key: { name: ctx.key.name, scopes: ctx.key.scopes, rateLimitPerMinute: ctx.key.rateLimit },
    docs: `${ctx.origin}/charts/api`,
    endpoints: {
      "POST /api/v1/charts": "Make a chart from { ticker, template, ... } or { spec }. Returns figures and file links.",
      "GET /api/v1/charts/<id>": "A chart you made, with file links.",
      "POST /api/v1/charts/bulk": "Up to 100 charts, one design. Returns a batchId; poll the batch.",
      "GET /api/v1/charts/batches/<batchId>": "Batch status and its charts.",
      "GET /api/v1/charts/batches/<batchId>/zip?format=png": "Every chart in a batch as a ZIP.",
      "GET /api/v1/charts/templates": "Templates, by slug.",
      "GET /api/v1/charts/tickers?q=nvidia": "Symbol search (stocks, ETFs, crypto).",
      "GET /api/v1/charts/files/<token>.<png|jpg|svg|pdf|ai>": "The file. No key needed: the token is the credential. ?scale=1-4, ?download=1, ?fonts=embed (SVG).",
    },
    scopes: API_SCOPES,
    fields: {
      periods: CHART_PERIODS.filter((p) => p !== "CUSTOM"),
      intervals: INTERVALS,
      sizes: Object.keys(SIZE_PRESETS),
      chartTypes: CHART_TYPES,
      perfColors: PERF_COLORS,
      compareModes: COMPARE_MODES,
      maxCompareLines: MAX_COMPARE,
    },
    tokens: { ...TOKEN_HELP, "gain2…gain5": "Total change of compare lines 1-4", "name2…name5": "Compare line names" },
    rules: [
      "Numbers come from the data. Write {gain} or {gainRounded} in a headline; never type a figure.",
      "Read warnings and pass them on.",
    ],
  }),
);

/** Make one chart: the server fetches the data, draws it, saves it with the exact bars, returns links. */
export const POST = withApi("charts.render", async (ctx, request) => {
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  const body = (parsed.body ?? {}) as Record<string, unknown>;
  const templates = await templatesFor(ctx.organizationId);
  const template = body.spec === undefined ? findTemplate(templates, body.template) : null;
  if (template === undefined) return apiError(404, `No template "${String(body.template)}". GET /api/v1/charts/templates lists them.`, "template");
  const built = botSpec(body, template?.style ?? null, template?.id ?? null, todayIso());
  if (!built.ok) return apiError(400, built.error, built.field);

  const db = tenantDb(ctx.organizationId);
  let projectId: string | null = null;
  if (typeof body.projectId === "string" || typeof body.projectName === "string") {
    const project =
      typeof body.projectId === "string" && /^[0-9a-f-]{36}$/i.test(body.projectId)
        ? await db.chartProject.findFirst({ where: { id: body.projectId, brandId: ctx.brandId, deletedAt: null }, select: { id: true } })
        : typeof body.projectName === "string" && body.projectName.trim()
          ? ((await db.chartProject.findFirst({ where: { name: body.projectName.trim().slice(0, 120), brandId: ctx.brandId, deletedAt: null }, select: { id: true } })) ??
            (await db.chartProject.create({ data: { organizationId: ctx.organizationId, brandId: ctx.brandId, name: body.projectName.trim().slice(0, 120), description: "Made by the bot API" }, select: { id: true } })))
          : null;
    if (!project) return apiError(404, "That project does not exist.", "projectId");
    projectId = project.id;
  }

  const saved = await saveChart(ctx.scope, { spec: built.spec, projectId, name: typeof body.name === "string" ? body.name : undefined, via: "api", apiKeyId: ctx.key.id });
  if (!saved.ok) return apiError(422, saved.error, "ticker");
  ctx.chartId = saved.id;
  const row = await db.chart.findFirst({ where: { id: saved.id }, select: CHART_JSON_SELECT });
  if (!row) return apiError(500, "The chart was not saved.");
  return apiJson(201, chartJson(ctx.origin, row));
});
