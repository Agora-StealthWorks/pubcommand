import { appendPlatformAudit, type Prisma } from "@pubcommand/db";
import { frameNote } from "../../../../../modules/knowledge/industry-lens";
import { frontmatterNiche, withNicheFrontmatter, type NoteNiche } from "../../../../../modules/knowledge/main-brain";
import { importDecision, planVaultImport, type ExistingNote } from "../../../../../modules/knowledge/vault";
import { readVaultZip } from "../../../../../modules/knowledge/zip";
import type { StoredReport } from "../brain/vault-import";
import { mainBrain } from "./db";
import { uniqueMainSlug } from "./learn";

/**
 * Console vault import into the main Brain. Same rules and dry run as a brand
 * import (modules/knowledge/vault.ts); notes are keyed `vault:<path>` so
 * re-importing the same vault updates notes in place.
 */
export async function planMainFromZip(bytes: Uint8Array, defaultNiche: NoteNiche = "general") {
  const read = readVaultZip(bytes);
  if (!read.ok) return { ok: false as const, error: read.error };
  // The Master Brain's industry lens (no "competitors"); keys stay the original vault paths.
  const decisions = read.files.map((file) => {
    const decision = importDecision(file.path, file.text);
    if (!decision.ok) return decision;
    // A note's own `niche:` frontmatter wins; otherwise the niche chosen for the upload. Either way
    // the niche is written into the note's markdown.
    const note = frameNote(decision.note);
    return { ...decision, note: { ...note, body: withNicheFrontmatter(note.body, frontmatterNiche(note.body) ?? defaultNiche) } };
  });
  const keys = decisions.flatMap((decision) => (decision.ok ? [decision.note.sourceRef] : []));
  const existing = new Map<string, ExistingNote>();
  for (let i = 0; i < keys.length; i += 500) {
    const rows = await mainBrain((tx) =>
      tx.mainBrainNote.findMany({ where: { key: { in: keys.slice(i, i + 500) } }, select: { id: true, key: true, title: true, body: true, folder: true, deletedAt: true } }),
    );
    for (const row of rows) existing.set(row.key, { ...row, brandId: null });
  }
  const plan = planVaultImport(decisions, existing, null);
  return { ok: true as const, ...plan, rootPrefix: read.rootPrefix };
}

export function asNiche(value: string | null | undefined): NoteNiche {
  return value === "finance" || value === "health" ? value : "general";
}

const running = new Set<string>();

export async function runMainVaultImport(input: { importId: string; actorId: string | null }): Promise<void> {
  if (running.has(input.importId)) return;
  running.add(input.importId);
  try {
    const job = await mainBrain((tx) => tx.mainBrainImport.findUnique({ where: { id: input.importId } }));
    if (!job) return;
    await mainBrain((tx) => tx.mainBrainImport.update({ where: { id: job.id }, data: { status: "RUNNING", error: null } }));
    const plan = await planMainFromZip(new Uint8Array(job.data), asNiche(job.niche));
    if (!plan.ok) throw new Error(plan.error);
    let created = 0;
    let updated = 0;
    let failed = 0;
    const rows = plan.rows.filter((row) => row.action === "create" || row.action === "update");
    // Batches keep each transaction short. A failed batch rolls back as a whole
    // and is counted as failed; running the import again picks it up.
    for (let i = 0; i < rows.length; i += 50) {
      const batch = rows.slice(i, i + 50);
      try {
        const done = await mainBrain(
          async (tx) => {
            let c = 0;
            let u = 0;
            for (const row of batch) {
              if (row.action === "create") {
                await tx.mainBrainNote.create({
                  data: {
                    key: row.note.sourceRef,
                    title: row.note.title,
                    slug: await uniqueMainSlug(tx, row.note.title),
                    body: row.note.body,
                    folder: row.note.folder,
                    origin: "IMPORTED",
                    niche: frontmatterNiche(row.note.body) ?? asNiche(job.niche),
                    source: "vault-import",
                    originSourceRef: row.note.sourceRef,
                    createdById: input.actorId,
                  },
                });
                c += 1;
              } else if (row.existingId) {
                await tx.mainBrainNote.updateMany({
                  where: { id: row.existingId, deletedAt: null },
                  data: { title: row.note.title, body: row.note.body, folder: row.note.folder, niche: frontmatterNiche(row.note.body) ?? asNiche(job.niche), updatedById: input.actorId },
                });
                u += 1;
              }
            }
            return { c, u };
          },
          { timeout: 60_000 },
        );
        created += done.c;
        updated += done.u;
      } catch (error) {
        failed += batch.length;
        console.error("[main-brain] import batch failed", batch[0]?.note.path, error);
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
    await mainBrain((tx) =>
      tx.mainBrainImport.update({
        where: { id: job.id },
        data: { status: "DONE", report: report as unknown as Prisma.InputJsonValue, data: new Uint8Array(0), error: failed ? `${failed} notes could not be saved; run the import again.` : null },
      }),
    );
    await appendPlatformAudit({ actorId: input.actorId, action: "main_brain.vault.imported", targetType: "main_brain_import", targetId: job.id, metadata: { created, updated, failed } });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "The import failed.";
    await mainBrain((tx) => tx.mainBrainImport.updateMany({ where: { id: input.importId }, data: { status: "FAILED", error: reason } })).catch(() => undefined);
  } finally {
    running.delete(input.importId);
  }
}
