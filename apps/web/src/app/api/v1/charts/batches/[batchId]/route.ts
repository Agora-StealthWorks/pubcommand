import { tenantDb } from "@pubcommand/db";
import { CHART_JSON_SELECT, apiError, apiJson, chartJson, withApi } from "@/features/charts/api";
import { loadBatch } from "@/features/charts/data";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  return withApi("charts.bulk", async (ctx) => {
    const batch = await loadBatch(ctx.organizationId, ctx.brandId, batchId);
    if (!batch) return apiError(404, "No such batch for this key's brand.");
    const charts = await tenantDb(ctx.organizationId).chart.findMany({ where: { batchId: batch.id, deletedAt: null }, orderBy: { createdAt: "asc" }, select: CHART_JSON_SELECT });
    const zip = (format: string) => `${ctx.origin}/api/v1/charts/batches/${batch.id}/zip?format=${format}`;
    return apiJson(200, {
      batchId: batch.id,
      status: batch.status,
      total: batch.total,
      done: batch.done,
      failed: batch.failed,
      errors: batch.errorsList,
      charts: charts.map((row) => chartJson(ctx.origin, row)),
      zip: batch.status === "DONE" ? { png: zip("png"), jpg: zip("jpg"), svg: zip("svg"), pdf: zip("pdf"), ai: zip("ai") } : null,
    });
  })(request);
}
