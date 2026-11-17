import { tenantDb } from "@pubcommand/db";
import { generateFileToken } from "../../../../../../../../modules/charts/api-keys";
import { CHART_JSON_SELECT, apiError, apiJson, chartJson, withApi } from "@/features/charts/api";

export const dynamic = "force-dynamic";

/** One chart of this key's brand, with its figures and file links. */
export async function GET(request: Request, { params }: { params: Promise<{ chartId: string }> }) {
  const { chartId } = await params;
  return withApi("charts.render", async (ctx) => {
    if (!/^[0-9a-f-]{36}$/i.test(chartId)) return apiError(404, "No such chart.");
    const db = tenantDb(ctx.organizationId);
    let row = await db.chart.findFirst({ where: { id: chartId, brandId: ctx.brandId, deletedAt: null }, select: CHART_JSON_SELECT });
    if (!row) return apiError(404, "No such chart for this key's brand.");
    if (!row.fileToken) {
      // Charts saved before file links existed get a token the first time a bot asks for them.
      await db.chart.updateMany({ where: { id: row.id, fileToken: null }, data: { fileToken: generateFileToken() } });
      row = (await db.chart.findFirst({ where: { id: row.id }, select: CHART_JSON_SELECT })) ?? row;
    }
    ctx.chartId = row.id;
    return apiJson(200, chartJson(ctx.origin, row));
  })(request);
}
