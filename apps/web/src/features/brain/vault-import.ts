import { appendOrgAudit, tenantDb, type Prisma } from "@pubcommand/db";
import { slugifyName } from "@pubcommand/core";
import { importDecision, planVaultImport, type ExistingNote, type ImportReport } from "../../../../../modules/knowledge/vault";
import { readVaultZip } from "../../../../../modules/knowledge/zip";

export const MAX_VAULT_ZIP_BYTES = 55 * 1024 * 1024;
export const STALE_IMPORT_MS = 15 * 60 * 1000;

export type StoredReport = ImportReport & {
  rootPrefix?: string;
  result?: { created: number; updated: number; unchanged: number; skipped: number; failed: number; finishedAt: string };
};

/** Read a zip and compare it with what the organization already has. */
export async function planFromZip(organizationId: string, bytes: Uint8Array, targetBrandId: string | null) {
  const read = readVaultZip(bytes);
  if (!read.ok) return { ok: false as const, error: read.error };
  const decisions = read.files.map((file) => importDecision(file.path, file.text));
  const refs = decisions.flatMap((decision) => (decision.ok ? [decision.note.sourceRef] : []));
  const existing = new Map<string, ExistingNote>();
  const db = tenantDb(organizationId);
  for (let i = 0; i < refs.length; i += 500) {
    const rows = await db.knowledgePage.findMany({
      where: { sourceRef: { in: refs.slice(i, i + 500) } },
      select: { id: true, sourceRef: true, brandId: true, title: true, body: true, folder: true, deletedAt: true },
    });
    for (const row of rows) if (row.sourceRef) existing.set(row.sourceRef, row);
  }
  const plan = planVaultImport(decisions, existing, targetBrandId);
  return { ok: true as const, ...plan, rootPrefix: read.rootPrefix };
}

const running = new Set<string>();

/** Apply a dry-run plan. Idempotent: re-plans against the current DB first. */
export async function runVaultImport(input: { organizationId: string; importId: string; actorId: string | null }): Promise<void> {
  const key = `${input.organizationId}:${input.importId}`;
  if (running.has(key)) return;
  running.add(key);
  const db = tenantDb(input.organizationId);
  try {
    const job = await db.knowledgeImport.findFirst({ where: { id: input.importId } });
    if (!job) return;
    await db.knowledgeImport.updateMany({ where: { id: job.id }, data: { status: "RUNNING", error: null } });
    const plan = await planFromZip(input.organizationId, new Uint8Array(job.data), job.brandId);
    if (!plan.ok) throw new Error(plan.error);

    const slugs = new Set((await db.knowledgePage.findMany({ select: { slug: true } })).map((row) => row.slug));
    const nextSlug = (title: string) => {
      const base = (slugifyName(title) || "note").slice(0, 60);
      let slug = base;
      for (let n = 2; slugs.has(slug); n += 1) slug = `${base}-${n}`;
      slugs.add(slug);
      return slug;
    };
    let created = 0;
    let updated = 0;
    let failed = 0;
    for (const row of plan.rows) {
      try {
        if (row.action === "create") {
          await db.knowledgePage.create({
            data: {
              organizationId: input.organizationId,
              brandId: job.brandId,
              title: row.note.title,
              slug: nextSlug(row.note.title),
              body: row.note.body,
              folder: row.note.folder,
              source: "vault-import",
              sourceRef: row.note.sourceRef,
              visibility: "PRIVATE",
              createdById: input.actorId,
            },
          });
          created += 1;
        } else if (row.action === "update" && row.existingId) {
          // Same Brain only (planVaultImport never plans a cross-Brain update).
          await db.knowledgePage.updateMany({
            where: { id: row.existingId, brandId: job.brandId, deletedAt: null },
            data: { title: row.note.title, body: row.note.body, folder: row.note.folder, updatedById: input.actorId },
          });
          updated += 1;
        }
      } catch (error) {
        failed += 1;
        console.error("[brain] import row failed", row.note.path, error);
      }
    }
    const report: StoredReport = {
      ...plan.report,
      rootPrefix: plan.rootPrefix,
      result: {
        created,
        updated,
        unchanged: plan.report.unchanged,
        skipped: Object.values(plan.report.skipped).reduce((sum, n) => sum + (n ?? 0), 0) + plan.report.conflict + plan.report.deleted,
        failed,
        finishedAt: new Date().toISOString(),
      },
    };
    // The zip is no longer needed once imported.
    await db.knowledgeImport.updateMany({
      where: { id: job.id },
      data: { status: "DONE", report: report as unknown as Prisma.InputJsonValue, data: new Uint8Array(0), error: failed ? `${failed} notes could not be saved.` : null },
    });
    await appendOrgAudit(input.organizationId, {
      actorId: input.actorId,
      action: "brain.vault.imported",
      targetType: "knowledge_import",
      targetId: job.id,
      metadata: { brandId: job.brandId, created, updated, failed },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "The import failed.";
    await db.knowledgeImport.updateMany({ where: { id: input.importId }, data: { status: "FAILED", error: reason } }).catch(() => undefined);
  } finally {
    running.delete(key);
  }
}

export function isStaleRun(status: string, updatedAt: Date, ms: number): boolean {
  return (status === "RUNNING" || status === "QUEUED") && Date.now() - updatedAt.getTime() > ms;
}
