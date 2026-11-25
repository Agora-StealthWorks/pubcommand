import { slugifyName } from "@pubcommand/core";
import { appendOrgAudit, tenantDb } from "@pubcommand/db";
import { learnUp } from "../main-brain/learn";

/**
 * Write or refresh one note in a Brain. Any app calls this to teach the Brain.
 *
 * - brandId set: the brand's mini-brain (private to that brand by default).
 * - brandId null: no brand Brain is written; the note goes to the platform
 *   main Brain only (staff review it there and may push it down to brands).
 * - sourceRef is the idempotency key, e.g. "promo:<id>". The same sourceRef
 *   updates the existing note instead of adding a duplicate.
 * - visibility "SHARED" makes the note visible to the organization's other
 *   brands (best practices only; never a brand's private data).
 *
 * Every taught note is also learned by the platform main Brain (learnUp), with
 * its provenance. That is internal to the Brain module and never shown in an
 * organization.
 *
 * Soft-fails: a Brain problem never breaks the app that called it.
 */
export async function teachBrain(input: {
  organizationId: string;
  brandId: string | null;
  sourceRef: string;
  title: string;
  body: string;
  folder?: string;
  source: string;
  visibility?: "PRIVATE" | "SHARED";
  actorId: string | null;
  /** For brandId null: the niche of the brand it came from, so the main Brain files it in the right niche. */
  niche?: string | null;
}): Promise<void> {
  try {
    if (input.brandId === null) {
      await learnUp({ ...input, folder: input.folder ?? null, noteId: null });
      return;
    }
    const db = tenantDb(input.organizationId);
    const existing = await db.knowledgePage.findFirst({ where: { sourceRef: input.sourceRef } });
    let noteId: string;
    if (existing) {
      await db.knowledgePage.updateMany({
        where: { id: existing.id },
        // A fresh write from the app brings back a note someone had deleted in the Brain.
        data: { title: input.title, body: input.body, deletedAt: null, ...(input.folder ? { folder: input.folder } : {}) },
      });
      noteId = existing.id;
    } else {
      const base = (slugifyName(input.title) || "note").slice(0, 60);
      let slug = base;
      for (let n = 2; await db.knowledgePage.count({ where: { slug } }); n += 1) slug = `${base}-${n}`;
      const created = await db.knowledgePage.create({
        data: {
          organizationId: input.organizationId,
          brandId: input.brandId,
          title: input.title,
          slug,
          body: input.body,
          folder: input.folder ?? null,
          source: input.source,
          sourceRef: input.sourceRef,
          visibility: input.visibility ?? "PRIVATE",
          createdById: input.actorId,
        },
      });
      noteId = created.id;
      await appendOrgAudit(input.organizationId, {
        actorId: input.actorId,
        action: "brain.taught",
        targetType: "knowledge_page",
        targetId: input.sourceRef,
      });
    }
    await learnUp({
      organizationId: input.organizationId,
      brandId: input.brandId,
      sourceRef: input.sourceRef,
      title: input.title,
      body: input.body,
      folder: input.folder ?? existing?.folder ?? null,
      source: input.source,
      noteId,
    });
  } catch (error) {
    console.error("[brain] teach failed", input.sourceRef, error);
  }
}
