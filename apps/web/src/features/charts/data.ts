import { tenantDb } from "@pubcommand/db";
import { STALE_MS } from "./server";

export async function listProjects(organizationId: string, brandId: string) {
  const db = tenantDb(organizationId);
  const projects = await db.chartProject.findMany({ where: { brandId, deletedAt: null }, orderBy: { updatedAt: "desc" }, take: 200 });
  const counts = await Promise.all(projects.map((project) => db.chart.count({ where: { projectId: project.id, deletedAt: null } })));
  return projects.map((project, index) => ({ ...project, chartCount: counts[index] ?? 0 }));
}

export async function listRecentCharts(organizationId: string, brandId: string, where: { projectId?: string | null; batchId?: string } = {}, take = 60) {
  return tenantDb(organizationId).chart.findMany({
    where: { brandId, deletedAt: null, ...where },
    orderBy: { updatedAt: "desc" },
    take,
    select: { id: true, name: true, symbol: true, spec: true, bars: true, source: true, seriesName: true, unit: true, headline: true, headlineOverridden: true, tokens: true, updatedAt: true, projectId: true },
  });
}

export async function loadBatch(organizationId: string, brandId: string, batchId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) return null;
  const batch = await tenantDb(organizationId).chartBatch.findFirst({ where: { id: batchId, brandId } });
  if (!batch) return null;
  const stale = (batch.status === "RUNNING" || batch.status === "QUEUED") && Date.now() - batch.updatedAt.getTime() > STALE_MS;
  return { ...batch, status: stale ? "FAILED" : batch.status, errorsList: (Array.isArray(batch.errors) ? batch.errors : []).filter((e): e is string => typeof e === "string"), stale };
}

export async function listBatches(organizationId: string, brandId: string) {
  return tenantDb(organizationId).chartBatch.findMany({ where: { brandId }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, status: true, total: true, done: true, failed: true, createdAt: true } });
}
