import { rawPrisma, tenantDb } from "@pubcommand/db";
import { slugifyName } from "@pubcommand/core";
import { parsePushedSourceRef, planPush, pushedSourceRef, pushTargets, type BrandRef, type PushedCopy } from "../../../../../modules/knowledge/main-brain";
import { BEST_PRACTICE_FOLDER, BEST_PRACTICE_SOURCE } from "../../../../../modules/knowledge/visibility";
import { mainBrain } from "./db";

/**
 * Push down: staff pick main-Brain notes for all brands or chosen brands. Each
 * target brand gets an ordinary read-only note in its own Brain (source
 * "best-practices", folder "Best practices"), plus copies of the note's
 * attachments. Nothing in the copy says where it came from.
 *
 * syncPushDown() makes every brand's copies match the console. It is
 * idempotent; the console calls it after a change and the knowledge.push-down
 * job runs it hourly (so new brands get the notes pushed to "all brands").
 */
export type PushSummary = { notes: number; created: number; updated: number; removed: number; unchanged: number; failed: number };

type MainNoteForPush = {
  id: string;
  title: string;
  body: string;
  pushScope: "NONE" | "ALL" | "SELECTED";
  niche: string;
  deletedAt: Date | null;
  targets: BrandRef[];
  attachments: { id: string; filename: string; contentType: string; size: number }[];
};

async function allBrands(): Promise<BrandRef[]> {
  const brands = await rawPrisma().brand.findMany({
    where: { organization: { suspendedAt: null } },
    select: { id: true, organizationId: true, niche: true },
  });
  return brands;
}

async function loadPushedNotes(noteIds?: string[]): Promise<MainNoteForPush[]> {
  return mainBrain(async (tx) => {
    const rows = await tx.mainBrainNote.findMany({
      where: noteIds ? { id: { in: noteIds } } : { OR: [{ pushScope: { not: "NONE" } }, { pushedAt: { not: null } }] },
      select: {
        id: true,
        title: true,
        body: true,
        pushScope: true,
        niche: true,
        deletedAt: true,
        pushTargets: { select: { brandId: true, targetOrganizationId: true } },
        attachments: { select: { id: true, filename: true, contentType: true, size: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      pushScope: row.pushScope,
      niche: row.niche,
      deletedAt: row.deletedAt,
      targets: row.pushTargets.map((target) => ({ id: target.brandId, organizationId: target.targetOrganizationId })),
      attachments: row.attachments,
    }));
  });
}

/** Every pushed copy in one organization, keyed by its main note. */
async function copiesIn(organizationId: string): Promise<(PushedCopy & { attachmentNames: string[] })[]> {
  const rows = await tenantDb(organizationId).knowledgePage.findMany({
    where: { source: BEST_PRACTICE_SOURCE },
    select: { id: true, brandId: true, sourceRef: true, title: true, body: true, folder: true, deletedAt: true, attachments: { select: { filename: true, size: true } } },
  });
  return rows.flatMap((row) => {
    const ref = parsePushedSourceRef(row.sourceRef);
    if (!ref) return [];
    return [
      {
        id: row.id,
        brandId: row.brandId,
        mainNoteId: ref.mainNoteId,
        title: row.title,
        body: row.body,
        folder: row.folder,
        deletedAt: row.deletedAt,
        attachmentNames: row.attachments.map((file) => `${file.filename}:${file.size}`).sort(),
      },
    ];
  });
}

async function uniqueOrgSlug(organizationId: string, title: string): Promise<string> {
  const base = (slugifyName(title) || "note").slice(0, 60);
  const db = tenantDb(organizationId);
  let slug = base;
  for (let n = 2; await db.knowledgePage.count({ where: { slug } }); n += 1) slug = `${base}-${n}`;
  return slug;
}

async function syncAttachments(organizationId: string, copyId: string, note: MainNoteForPush, current: string[]) {
  const wanted = note.attachments.map((file) => `${file.filename}:${file.size}`).sort();
  if (wanted.join("|") === current.join("|")) return;
  const db = tenantDb(organizationId);
  await db.knowledgeAttachment.deleteMany({ where: { noteId: copyId } });
  if (note.attachments.length === 0) return;
  const files = await mainBrain((tx) => tx.mainBrainAttachment.findMany({ where: { noteId: note.id }, select: { filename: true, contentType: true, size: true, data: true } }));
  for (const file of files) {
    await db.knowledgeAttachment.create({
      data: { organizationId, noteId: copyId, filename: file.filename, contentType: file.contentType, size: file.size, data: file.data },
    });
  }
}

export async function syncPushDown(options: { noteIds?: string[] } = {}): Promise<PushSummary> {
  const summary: PushSummary = { notes: 0, created: 0, updated: 0, removed: 0, unchanged: 0, failed: 0 };
  const notes = await loadPushedNotes(options.noteIds);
  if (notes.length === 0) return summary;
  const brands = await allBrands();
  const orgIds = [...new Set([...brands.map((brand) => brand.organizationId), ...notes.flatMap((note) => note.targets.map((t) => t.organizationId))])];
  const copiesByOrg = new Map<string, Awaited<ReturnType<typeof copiesIn>>>();
  for (const orgId of orgIds) copiesByOrg.set(orgId, await copiesIn(orgId));

  for (const note of notes) {
    summary.notes += 1;
    const scope = note.deletedAt ? "NONE" : note.pushScope;
    const targets = pushTargets(scope, note.targets, brands, note.niche);
    for (const orgId of orgIds) {
      const copies = copiesByOrg.get(orgId) ?? [];
      const plan = planPush(
        note,
        targets.filter((brand) => brand.organizationId === orgId),
        copies,
      );
      const db = tenantDb(orgId);
      summary.unchanged += plan.unchanged;
      try {
        for (const brand of plan.create) {
          const created = await db.knowledgePage.create({
            data: {
              organizationId: orgId,
              brandId: brand.id,
              title: note.title,
              slug: await uniqueOrgSlug(orgId, note.title),
              body: note.body,
              folder: BEST_PRACTICE_FOLDER,
              source: BEST_PRACTICE_SOURCE,
              sourceRef: pushedSourceRef(note.id, brand.id),
              visibility: "PRIVATE",
            },
          });
          await syncAttachments(orgId, created.id, note, []);
          summary.created += 1;
        }
        for (const row of plan.update) {
          await db.knowledgePage.updateMany({
            where: { id: row.copyId, source: BEST_PRACTICE_SOURCE },
            data: { title: note.title, body: note.body, folder: BEST_PRACTICE_FOLDER, deletedAt: null },
          });
          summary.updated += 1;
        }
        if (plan.remove.length) {
          await db.knowledgePage.updateMany({ where: { id: { in: plan.remove }, source: BEST_PRACTICE_SOURCE }, data: { deletedAt: new Date() } });
          summary.removed += plan.remove.length;
        }
        // Attachments follow the note (also for unchanged copies).
        for (const copy of copies.filter((c) => c.mainNoteId === note.id && c.brandId && targets.some((t) => t.id === c.brandId))) {
          await syncAttachments(orgId, copy.id, note, copy.attachmentNames);
        }
      } catch (error) {
        summary.failed += 1;
        console.error("[main-brain] push-down failed", note.id, orgId, error);
      }
    }
  }
  return summary;
}

/** Which brands currently hold a live copy of a main note (console view). */
export async function pushedCopies(noteId: string): Promise<{ brandId: string; organizationId: string }[]> {
  const brands = await rawPrisma().brand.findMany({ select: { id: true, organizationId: true } });
  const orgIds = [...new Set(brands.map((brand) => brand.organizationId))];
  const out: { brandId: string; organizationId: string }[] = [];
  for (const orgId of orgIds) {
    const rows = await tenantDb(orgId).knowledgePage.findMany({
      where: { source: BEST_PRACTICE_SOURCE, deletedAt: null, sourceRef: { startsWith: `${BEST_PRACTICE_SOURCE}:${noteId}:` } },
      select: { brandId: true },
    });
    for (const row of rows) if (row.brandId) out.push({ brandId: row.brandId, organizationId: orgId });
  }
  return out;
}
