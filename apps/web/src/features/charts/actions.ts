"use server";

import { appendOrgAudit, tenantDb, type Prisma } from "@pubcommand/db";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { parseBulkRows } from "../../../../../modules/charts/bulk";
import { SIZE_PRESETS, normalizeData, normalizeSpec, styleOf, TEMPLATE_CATEGORIES, type SizePreset } from "../../../../../modules/charts/spec";
import { chartsAccess } from "./context";
import { imageSize } from "./export";
import { loadSeries, todayIso, type SeriesResult } from "./market";
import { listTemplates, runBulk, saveChart } from "./server";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const UUID = /^[0-9a-f-]{36}$/i;

function field(formData: FormData, key: string, max = 300): string {
  return String(formData.get(key) ?? "").trim().slice(0, max);
}

/** Bars for the live preview. The server fetches them; the browser only draws. */
export async function fetchSeriesAction(data: unknown): Promise<SeriesResult> {
  const access = await chartsAccess();
  if (!access.ok) return { ok: false, error: access.error, code: "forbidden" };
  return loadSeries(normalizeData(data, todayIso()));
}

export type SaveResult = { ok: true; id: string; overridden: boolean } | { ok: false; error: string };

export async function saveChartAction(input: { spec: unknown; chartId?: string | null; projectId?: string | null; name?: string; asCopy?: boolean }): Promise<SaveResult> {
  const access = await chartsAccess();
  if (!access.ok) return { ok: false, error: access.error };
  const chartId = !input.asCopy && input.chartId && UUID.test(input.chartId) ? input.chartId : null;
  const projectId = input.projectId === undefined ? undefined : input.projectId && UUID.test(input.projectId) ? input.projectId : null;
  return saveChart(access.scope, { spec: input.spec, chartId, projectId, name: input.name });
}

export async function createProjectAction(input: { name: string; description?: string }): Promise<{ ok: true; id: string; name: string } | { ok: false; error: string }> {
  const access = await chartsAccess();
  if (!access.ok) return { ok: false, error: access.error };
  const name = input.name.trim().slice(0, 120);
  if (!name) return { ok: false, error: "Name the project." };
  const project = await tenantDb(access.scope.organizationId).chartProject.create({
    data: { organizationId: access.scope.organizationId, brandId: access.scope.brandId, name, description: (input.description ?? "").trim().slice(0, 500), createdById: access.scope.actorId },
  });
  await appendOrgAudit(access.scope.organizationId, { actorId: access.scope.actorId, action: "chart.project.created", targetType: "chart_project", targetId: project.id });
  return { ok: true, id: project.id, name: project.name };
}

export async function createProjectForm(formData: FormData) {
  const result = await createProjectAction({ name: field(formData, "name", 120), description: field(formData, "description", 500) });
  if (!result.ok) redirect(`/charts/projects?error=${encodeURIComponent(result.error)}`);
  redirect(`/charts/projects/${result.id}?notice=Project created.`);
}

export async function renameProjectForm(formData: FormData) {
  const access = await chartsAccess();
  if (!access.ok) redirect(`/charts/projects?error=${encodeURIComponent(access.error)}`);
  const id = field(formData, "projectId", 40);
  const name = field(formData, "name", 120);
  if (!UUID.test(id) || !name) redirect(`/charts/projects/${id}?error=Name the project.`);
  await tenantDb(access.scope.organizationId).chartProject.updateMany({ where: { id, brandId: access.scope.brandId, deletedAt: null }, data: { name, description: field(formData, "description", 500) } });
  await appendOrgAudit(access.scope.organizationId, { actorId: access.scope.actorId, action: "chart.project.updated", targetType: "chart_project", targetId: id });
  redirect(`/charts/projects/${id}?notice=Saved.`);
}

export async function deleteProjectForm(formData: FormData) {
  const access = await chartsAccess();
  if (!access.ok) redirect(`/charts/projects?error=${encodeURIComponent(access.error)}`);
  const id = field(formData, "projectId", 40);
  const db = tenantDb(access.scope.organizationId);
  const project = UUID.test(id) ? await db.chartProject.findFirst({ where: { id, brandId: access.scope.brandId, deletedAt: null } }) : null;
  if (!project) redirect("/charts/projects?error=That project no longer exists.");
  if (project.createdById !== access.scope.actorId && !access.canManage) redirect(`/charts/projects/${id}?error=Only the project's creator or a ChartBuilder admin can delete it.`);
  const now = new Date();
  await db.chartProject.updateMany({ where: { id }, data: { deletedAt: now } });
  await db.chart.updateMany({ where: { projectId: id, deletedAt: null }, data: { deletedAt: now } });
  await appendOrgAudit(access.scope.organizationId, { actorId: access.scope.actorId, action: "chart.project.deleted", targetType: "chart_project", targetId: id });
  redirect("/charts/projects?notice=Project deleted. Its charts are kept for the record.");
}

export async function deleteChartForm(formData: FormData) {
  const access = await chartsAccess();
  if (!access.ok) redirect(`/charts/projects?error=${encodeURIComponent(access.error)}`);
  const id = field(formData, "chartId", 40);
  const back = field(formData, "back", 200);
  const safeBack = back.startsWith("/charts") ? back : "/charts/projects";
  if (UUID.test(id)) {
    await tenantDb(access.scope.organizationId).chart.updateMany({ where: { id, brandId: access.scope.brandId }, data: { deletedAt: new Date() } });
    await appendOrgAudit(access.scope.organizationId, { actorId: access.scope.actorId, action: "chart.deleted", targetType: "chart", targetId: id });
  }
  redirect(`${safeBack}${safeBack.includes("?") ? "&" : "?"}notice=Chart deleted.`);
}

export async function saveTemplateAction(input: { name: string; description?: string; category: string; spec: unknown }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const access = await chartsAccess();
  if (!access.ok) return { ok: false, error: access.error };
  const name = input.name.trim().slice(0, 120);
  if (!name) return { ok: false, error: "Name the template." };
  const category = (TEMPLATE_CATEGORIES as readonly string[]).includes(input.category) ? input.category : "PROMO";
  const spec = normalizeSpec(input.spec, todayIso());
  // Sizes stay in the chart's design units, so the template scales to every canvas like a starter.
  const scaled = styleOf(spec);
  const row = await tenantDb(access.scope.organizationId).chartTemplate.create({
    data: {
      organizationId: access.scope.organizationId,
      name,
      description: (input.description ?? "").trim().slice(0, 300),
      category,
      style: scaled as unknown as Prisma.InputJsonValue,
      createdById: access.scope.actorId,
    },
  });
  await appendOrgAudit(access.scope.organizationId, { actorId: access.scope.actorId, action: "chart.template.created", targetType: "chart_template", targetId: row.id });
  return { ok: true, id: row.id };
}

export async function deleteTemplateForm(formData: FormData) {
  const access = await chartsAccess();
  if (!access.ok) redirect(`/charts/templates?error=${encodeURIComponent(access.error)}`);
  const id = field(formData, "templateId", 40);
  const db = tenantDb(access.scope.organizationId);
  const row = UUID.test(id) ? await db.chartTemplate.findFirst({ where: { id, deletedAt: null } }) : null;
  if (!row) redirect("/charts/templates?error=That template no longer exists.");
  const mine = row.createdById === access.scope.actorId;
  if (row.locked ? !access.canManage : !(mine || access.canManage)) redirect("/charts/templates?error=Only a ChartBuilder admin (charts.write) can delete that template.");
  await db.chartTemplate.updateMany({ where: { id }, data: { deletedAt: new Date() } });
  await appendOrgAudit(access.scope.organizationId, { actorId: access.scope.actorId, action: "chart.template.deleted", targetType: "chart_template", targetId: id });
  redirect("/charts/templates?notice=Template deleted.");
}

export async function uploadImageAction(formData: FormData): Promise<{ ok: true; id: string; aspect: number } | { ok: false; error: string }> {
  const access = await chartsAccess();
  if (!access.ok) return { ok: false, error: access.error };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose an image." };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "Images must be 5 MB or smaller." };
  const data = new Uint8Array(await file.arrayBuffer());
  const size = imageSize(data);
  if (!size || size.width < 1 || size.height < 1) return { ok: false, error: "Use a PNG or JPEG image." };
  const row = await tenantDb(access.scope.organizationId).chartAsset.create({
    data: {
      organizationId: access.scope.organizationId,
      brandId: access.scope.brandId,
      filename: file.name.slice(0, 200),
      mimeType: size.mime,
      width: size.width,
      height: size.height,
      size: data.length,
      data,
      createdById: access.scope.actorId,
    },
  });
  return { ok: true, id: row.id, aspect: size.width / size.height };
}

export async function startBulkForm(formData: FormData) {
  const access = await chartsAccess();
  if (!access.ok) redirect(`/charts/bulk?error=${encodeURIComponent(access.error)}`);
  const parsed = parseBulkRows(String(formData.get("rows") ?? "").slice(0, 40_000));
  if (parsed.errors.length) redirect(`/charts/bulk?error=${encodeURIComponent(parsed.errors.slice(0, 4).join(" "))}`);
  if (!parsed.rows.length) redirect("/charts/bulk?error=Add at least one row.");
  const templates = await listTemplates(access.scope.organizationId);
  const template = templates.find((t) => t.id === field(formData, "templateId", 40)) ?? templates[0];
  if (!template) redirect("/charts/bulk?error=Add a template first.");
  const preset = field(formData, "size", 20) as SizePreset;
  const size = SIZE_PRESETS[preset] ? { preset, w: SIZE_PRESETS[preset].w, h: SIZE_PRESETS[preset].h } : { preset: "promo" as const, w: 2000, h: 1000 };
  const db = tenantDb(access.scope.organizationId);
  const batch = await db.chartBatch.create({
    data: {
      organizationId: access.scope.organizationId,
      brandId: access.scope.brandId,
      status: "QUEUED",
      rows: parsed.rows as unknown as Prisma.InputJsonValue,
      design: { templateId: template.id, style: template.style, size } as unknown as Prisma.InputJsonValue,
      total: parsed.rows.length,
      createdById: access.scope.actorId,
    },
  });
  await appendOrgAudit(access.scope.organizationId, { actorId: access.scope.actorId, action: "chart.bulk.started", targetType: "chart_batch", targetId: batch.id });
  const scope = access.scope;
  after(() => runBulk(scope, batch.id));
  redirect(`/charts/bulk/${batch.id}`);
}

export async function saveBatchToProjectForm(formData: FormData) {
  const access = await chartsAccess();
  if (!access.ok) redirect(`/charts/bulk?error=${encodeURIComponent(access.error)}`);
  const batchId = field(formData, "batchId", 40);
  const db = tenantDb(access.scope.organizationId);
  let projectId = field(formData, "projectId", 40);
  const newName = field(formData, "newProject", 120);
  if (newName) {
    const created = await createProjectAction({ name: newName });
    if (!created.ok) redirect(`/charts/bulk/${batchId}?error=${encodeURIComponent(created.error)}`);
    projectId = created.id;
  }
  const project = UUID.test(projectId) ? await db.chartProject.findFirst({ where: { id: projectId, brandId: access.scope.brandId, deletedAt: null } }) : null;
  if (!project || !UUID.test(batchId)) redirect(`/charts/bulk/${batchId}?error=Pick a project or name a new one.`);
  await db.chart.updateMany({ where: { batchId, brandId: access.scope.brandId, deletedAt: null }, data: { projectId: project.id } });
  await appendOrgAudit(access.scope.organizationId, { actorId: access.scope.actorId, action: "chart.bulk.saved_to_project", targetType: "chart_batch", targetId: batchId });
  redirect(`/charts/projects/${project.id}?notice=Bulk charts added to the project.`);
}
