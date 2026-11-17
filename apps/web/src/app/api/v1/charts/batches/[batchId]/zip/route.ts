import { tenantDb } from "@pubcommand/db";
import { apiError, withApi } from "@/features/charts/api";
import { download, parseFormat, renderStored, zipFiles } from "@/features/charts/files";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  return withApi("charts.bulk", async (ctx) => {
    const format = parseFormat(new URL(request.url).searchParams.get("format") ?? "png");
    if (!format || format === "thumb") return apiError(400, "format must be png, jpg, svg, pdf or ai.", "format");
    if (!/^[0-9a-f-]{36}$/i.test(batchId)) return apiError(404, "No such batch.");
    const rows = await tenantDb(ctx.organizationId).chart.findMany({ where: { batchId, brandId: ctx.brandId, deletedAt: null }, orderBy: { createdAt: "asc" }, take: 100 });
    if (!rows.length) return apiError(404, "No charts in this batch yet.");
    const files = await renderStored(ctx.organizationId, rows, format);
    return download(zipFiles(files), "application/zip", `chart-batch-${batchId.slice(0, 8)}-${format}.zip`);
  })(request);
}
