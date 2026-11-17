import { tenantDb } from "@pubcommand/db";
import { chartsAccess } from "@/features/charts/context";
import { download, parseFormat, renderStored } from "@/features/charts/files";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string; chartId: string }> }) {
  const { slug, chartId } = await params;
  const access = await chartsAccess(slug);
  if (!access.ok) return new Response("Not found", { status: 404 });
  const format = parseFormat(new URL(request.url).searchParams.get("format") ?? "png");
  if (!format) return new Response("Unknown format", { status: 400 });
  if (!/^[0-9a-f-]{36}$/i.test(chartId)) return new Response("Not found", { status: 404 });
  const row = await tenantDb(access.scope.organizationId).chart.findFirst({ where: { id: chartId, brandId: access.scope.brandId, deletedAt: null } });
  if (!row) return new Response("Not found", { status: 404 });
  const [file] = await renderStored(access.scope.organizationId, [row], format);
  if (!file) return new Response("Not found", { status: 404 });
  if (format === "thumb") {
    return new Response(new Uint8Array(file.body), { headers: { "content-type": file.mime, "cache-control": "private, max-age=60" } });
  }
  return download(file.body, file.mime, file.filename);
}
