import { tenantDb } from "@pubcommand/db";
import { editorDraft, publicationDraft, pricingDraft, syncAction, type SourceDraft } from "../../../../../modules/support/sources";
import { getEditors, getPublications } from "../pubsetup/read";
import { gatedStatus, saveRecord } from "./records";

/**
 * Publication Setup → Support Knowledge. Public-safe fields only (see modules/support/sources.ts).
 * Create-or-update by sourceRef; a record a person edited here is locked and skipped; prices
 * always land as drafts until someone confirms them. Idempotent: unchanged sources are skipped.
 */

export type PubsetupSyncResult = { created: number; updated: number; unchanged: number; locked: number; held: number; errors: number };

export async function syncFromPubsetup(organizationId: string, brandId: string, actorId: string | null): Promise<PubsetupSyncResult> {
  const [publications, editors] = await Promise.all([getPublications(organizationId, brandId, { includeArchived: true }), getEditors(organizationId, brandId, { includeArchived: true })]);
  const drafts: SourceDraft[] = [];
  for (const pub of publications) {
    drafts.push(publicationDraft(pub));
    const price = pricingDraft(pub);
    if (price) drafts.push(price);
  }
  for (const editor of editors) drafts.push(editorDraft(editor));

  const db = tenantDb(organizationId);
  const existing = await db.supportRecord.findMany({ where: { brandId, source: "pubsetup" }, select: { id: true, sourceRef: true, sourceHash: true, locked: true } });
  const byRef = new Map(existing.map((row) => [row.sourceRef, row]));
  const result: PubsetupSyncResult = { created: 0, updated: 0, unchanged: 0, locked: 0, held: 0, errors: 0 };
  const scope = { organizationId, brandId, actorId, canPublish: true };

  for (const draft of drafts) {
    const row = byRef.get(draft.sourceRef) ?? null;
    const action = syncAction(row, draft);
    if (action === "unchanged") {
      result.unchanged += 1;
      continue;
    }
    if (action === "skip-locked") {
      result.locked += 1;
      continue;
    }
    const gated = draft.category === "pricing" ? { status: draft.status, hits: [] } : gatedStatus(draft.status, draft);
    if (gated.status !== draft.status) result.held += 1;
    const saved = await saveRecord(
      scope,
      row?.id ?? null,
      { ...draft, status: gated.status, summary: "", gateOverrides: [] },
      { source: "pubsetup", sourceRef: draft.sourceRef, sourceHash: draft.sourceHash, lock: false, note: "Publication Setup sync" },
    );
    if (!saved.ok) result.errors += 1;
    else if (row) result.updated += 1;
    else result.created += 1;
  }
  await db.supportSettings.updateMany({ where: { brandId }, data: { lastPubsetupAt: new Date(), lastPubsetupResult: result } });
  return result;
}
