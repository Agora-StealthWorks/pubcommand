import { slugifyName } from "@pubcommand/core";
import { rawPrisma, tenantDb, type Prisma } from "@pubcommand/db";
import { learnAction, learnedKey, shouldLearnUp } from "../../../../../modules/knowledge/main-brain";
import { mainBrain } from "./db";

/**
 * Learning up: copy one app-taught note into the platform main Brain, with its
 * provenance (organization, brand, app, sourceRef). Called by teachBrain() after
 * it writes the brand's note, and by the knowledge.learn-up job as a catch-up.
 * Idempotent (keyed by organization + sourceRef). A staff edit in the console
 * wins over later app writes; a staff delete is never undone. Never throws.
 */
export type LearnUpInput = {
  organizationId: string;
  brandId: string | null;
  sourceRef: string;
  title: string;
  body: string;
  folder: string | null;
  source: string;
  /** The brand note it was learned from, when there is one. */
  noteId?: string | null;
};

export type LearnUpResult = "created" | "refreshed" | "unchanged" | "skipped" | "failed";

export async function uniqueMainSlug(tx: Prisma.TransactionClient, title: string): Promise<string> {
  const base = (slugifyName(title) || "note").slice(0, 60);
  let slug = base;
  for (let n = 2; await tx.mainBrainNote.count({ where: { slug } }); n += 1) slug = `${base}-${n}`;
  return slug;
}

export async function learnUp(input: LearnUpInput): Promise<LearnUpResult> {
  try {
    const key = learnedKey(input.organizationId, input.sourceRef);
    return await mainBrain(async (tx) => {
      const existing = await tx.mainBrainNote.findUnique({ where: { key } });
      const action = learnAction(existing, input);
      const now = new Date();
      if (action === "skip") return "skipped";
      if (action === "create") {
        await tx.mainBrainNote.create({
          data: {
            key,
            title: input.title,
            slug: await uniqueMainSlug(tx, input.title),
            body: input.body,
            folder: input.folder,
            origin: "LEARNED",
            source: input.source,
            originOrganizationId: input.organizationId,
            originBrandId: input.brandId,
            originSourceRef: input.sourceRef,
            originNoteId: input.noteId ?? null,
            learnedAt: now,
          },
        });
        return "created";
      }
      const provenance = {
        originOrganizationId: input.organizationId,
        originBrandId: input.brandId,
        originSourceRef: input.sourceRef,
        ...(input.noteId ? { originNoteId: input.noteId } : {}),
        learnedAt: now,
      };
      if (action === "touch") {
        await tx.mainBrainNote.update({ where: { id: existing!.id }, data: provenance });
        return "unchanged";
      }
      await tx.mainBrainNote.update({
        where: { id: existing!.id },
        data: { ...provenance, title: input.title, body: input.body, folder: input.folder, source: input.source },
      });
      return "refreshed";
    });
  } catch (error) {
    console.error("[main-brain] learn-up failed", input.sourceRef, error);
    return "failed";
  }
}

/**
 * Catch-up for notes taught before learning-up existed, or whose learn-up failed:
 * every app-taught brand note updated after its main-Brain copy (or without one).
 */
export async function learnUpBackfill(options: { organizationIds?: string[]; limitPerOrg?: number } = {}): Promise<Record<string, number>> {
  const counts: Record<string, number> = { organizations: 0, checked: 0, created: 0, refreshed: 0, unchanged: 0, skipped: 0, failed: 0 };
  const orgIds = options.organizationIds ?? (await rawPrisma().organization.findMany({ where: { deletedAt: null }, select: { id: true } })).map((org) => org.id);
  for (const organizationId of orgIds) {
    counts.organizations! += 1;
    const notes = await tenantDb(organizationId).knowledgePage.findMany({
      where: { brandId: { not: null }, sourceRef: { not: null }, deletedAt: null, source: { notIn: ["member", "vault-import", "best-practices"] } },
      select: { id: true, brandId: true, sourceRef: true, title: true, body: true, folder: true, source: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: options.limitPerOrg ?? 5000,
    });
    const learnable = notes.filter((note) => shouldLearnUp(note));
    const keys = learnable.map((note) => learnedKey(organizationId, note.sourceRef!));
    const learned = new Map<string, Date | null>();
    for (let i = 0; i < keys.length; i += 500) {
      const rows = await mainBrain((tx) => tx.mainBrainNote.findMany({ where: { key: { in: keys.slice(i, i + 500) } }, select: { key: true, learnedAt: true } }));
      for (const row of rows) learned.set(row.key, row.learnedAt);
    }
    for (const note of learnable) {
      counts.checked! += 1;
      const at = learned.get(learnedKey(organizationId, note.sourceRef!));
      if (at && at >= note.updatedAt) continue;
      const result = await learnUp({ organizationId, brandId: note.brandId, sourceRef: note.sourceRef!, title: note.title, body: note.body, folder: note.folder, source: note.source, noteId: note.id });
      counts[result] = (counts[result] ?? 0) + 1;
    }
  }
  return counts;
}
