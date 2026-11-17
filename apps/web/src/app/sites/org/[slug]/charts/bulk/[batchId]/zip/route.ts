import { tenantDb } from "@pubcommand/db";
import { chartsAccess } from "@/features/charts/context";
import { download, parseFormat, renderStored, zipFiles } from "@/features/charts/files";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string; batchId: string }> }) {
  const { slug, batchId } = await params;
  const access = await chartsAccess(slug);
  if (!access.ok || !/^[0-9a-f-]{36}$/i.test(batchId)) return new Response("Not found", { status: 404 });
  const format = parseFormat(new URL(request.url).searchParams.get("format") ?? "png");
  if (!format || format === "thumb") return new Response("Unknown format", { status: 400 });
  const rows = await tenantDb(access.scope.organizationId).chart.findMany({ where: { batchId, brandId: access.scope.brandId, deletedAt: null }, orderBy: { createdAt: "asc" }, take: 100 });
  if (!rows.length) return new Response("No charts in this run", { status: 404 });
  const files = await renderStored(access.scope.organizationId, rows, format);
  return download(zipFiles(files), "application/zip", `chart-run-${batchId.slice(0, 8)}-${format}.zip`);
}
