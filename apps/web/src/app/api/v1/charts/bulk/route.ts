import { appendOrgAudit, tenantDb, type Prisma } from "@pubcommand/db";
import { after } from "next/server";
import { botBulkRows, botSpec } from "../../../../../../../../modules/charts/bot";
import { apiError, apiJson, findTemplate, readJson, templatesFor, withApi } from "@/features/charts/api";
import { todayIso } from "@/features/charts/market";
import { runBulk } from "@/features/charts/server";

export const dynamic = "force-dynamic";

/**
 * Up to 100 charts in one call. Every row is validated first (one bad row rejects the batch, naming it),
 * then the batch runs after the response, 4 charts at a time. Poll GET /api/v1/charts/batches/<id>.
 */
export const POST = withApi("charts.bulk", async (ctx, request) => {
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  const bulk = botBulkRows(parsed.body);
  if (bulk.errors.length) return apiError(400, bulk.errors.join(" "), "rows");
  const templates = await templatesFor(ctx.organizationId);
  const today = todayIso();
  const specs: unknown[] = [];
  const errors: string[] = [];
  let firstTemplate: { id: string; style: unknown } | null = null;
  for (const { index, body } of bulk.rows) {
    const template = findTemplate(templates, body.template);
    if (template === undefined) {
      errors.push(`Row ${index + 1}: no template "${String(body.template)}".`);
      continue;
    }
    firstTemplate ??= template ? { id: template.id, style: template.style } : null;
    const built = botSpec(body, template?.style ?? null, template?.id ?? null, today);
    if (!built.ok) errors.push(`Row ${index + 1}: ${built.error}`);
    else specs.push(built.spec);
  }
  if (errors.length) return apiError(400, errors.slice(0, 10).join(" "), "rows");

  const body = parsed.body as Record<string, unknown>;
  const db = tenantDb(ctx.organizationId);
  let projectId: string | null = null;
  if (typeof body.projectName === "string" && body.projectName.trim()) {
    const name = body.projectName.trim().slice(0, 120);
    const project =
      (await db.chartProject.findFirst({ where: { name, brandId: ctx.brandId, deletedAt: null }, select: { id: true } })) ??
      (await db.chartProject.create({ data: { organizationId: ctx.organizationId, brandId: ctx.brandId, name, description: "Made by the bot API" }, select: { id: true } }));
    projectId = project.id;
  } else if (typeof body.projectId === "string") {
    const project = /^[0-9a-f-]{36}$/i.test(body.projectId) ? await db.chartProject.findFirst({ where: { id: body.projectId, brandId: ctx.brandId, deletedAt: null }, select: { id: true } }) : null;
    if (!project) return apiError(404, "That project does not exist.", "projectId");
    projectId = project.id;
  }

  const batch = await db.chartBatch.create({
    data: {
      organizationId: ctx.organizationId,
      brandId: ctx.brandId,
      status: "QUEUED",
      rows: specs as Prisma.InputJsonValue,
      design: { kind: "specs", templateId: firstTemplate?.id ?? null, style: firstTemplate?.style ?? {}, size: { preset: "promo", w: 2000, h: 1000 }, apiKeyId: ctx.key.id, projectId } as unknown as Prisma.InputJsonValue,
      total: specs.length,
    },
  });
  await appendOrgAudit(ctx.organizationId, { actorId: null, action: "chart.bulk.started", targetType: "chart_batch", targetId: batch.id, metadata: { via: "api", apiKeyId: ctx.key.id } });
  const scope = ctx.scope;
  after(() => runBulk(scope, batch.id));
  return apiJson(202, { batchId: batch.id, status: "QUEUED", total: specs.length, statusUrl: `${ctx.origin}/api/v1/charts/batches/${batch.id}` });
});
