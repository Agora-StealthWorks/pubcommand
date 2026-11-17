import { tenantDb } from "@pubcommand/db";
import { chartsAccess } from "@/features/charts/context";
import { download, fileBase, parseFormat, renderStored, zipFiles } from "@/features/charts/files";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string; projectId: string }> }) {
  const { slug, projectId } = await params;
  const access = await chartsAccess(slug);
  if (!access.ok || !/^[0-9a-f-]{36}$/i.test(projectId)) return new Response("Not found", { status: 404 });
  const format = parseFormat(new URL(request.url).searchParams.get("format") ?? "png");
  if (!format || format === "thumb") return new Response("Unknown format", { status: 400 });
  const db = tenantDb(access.scope.organizationId);
  const project = await db.chartProject.findFirst({ where: { id: projectId, brandId: access.scope.brandId, deletedAt: null } });
  if (!project) return new Response("Not found", { status: 404 });
  const rows = await db.chart.findMany({ where: { projectId, deletedAt: null }, orderBy: { updatedAt: "desc" }, take: 100 });
  if (!rows.length) return new Response("No charts in this project", { status: 404 });
  const files = await renderStored(access.scope.organizationId, rows, format);
  return download(zipFiles(files), "application/zip", `${fileBase(project.name, "project")}-${format}.zip`);
}
