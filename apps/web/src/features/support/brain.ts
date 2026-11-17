import { tenantDb } from "@pubcommand/db";
import { brandScope } from "../../../../../modules/knowledge/visibility";
import { checkContent } from "../../../../../modules/support/gate";
import { noteToText } from "../../../../../modules/support/sources";
import { getVisibleNote, recentNotes } from "../brain/notes";
import { searchNotes } from "../brain/search";

/**
 * Brand Brain → Support Knowledge. The Brain is internal memory, so nothing is copied
 * automatically: a person picks a note, it becomes a proposal with the gate's verdict, and a
 * publisher approves it (the gate must pass on the final text) before a record exists.
 * Only the brand's own notes are offered, never another brand's shared notes.
 */

export type BrainCandidate = { id: string; title: string; folder: string | null; updatedAt: Date; snippet: string };

export async function brainCandidates(organizationId: string, brandId: string, query: string): Promise<BrainCandidate[]> {
  const scope = brandScope(brandId);
  if (query.trim()) {
    const hits = await searchNotes({ organizationId, scope, query, limit: 30 });
    return hits.filter((hit) => hit.brandId === brandId).map((hit) => ({ id: hit.id, title: hit.title, folder: hit.folder, updatedAt: hit.updatedAt, snippet: hit.snippet }));
  }
  const notes = (await recentNotes(organizationId, scope, 30)) as { id: string; title: string; folder: string | null; updatedAt: Date; brandId: string | null }[];
  return notes.filter((note) => note.brandId === brandId).map((note) => ({ id: note.id, title: note.title, folder: note.folder, updatedAt: note.updatedAt, snippet: "" }));
}

export async function proposeBrainNote(input: { organizationId: string; brandId: string; actorId: string; noteId: string }): Promise<{ ok: true; id: string; blocked: string[] } | { ok: false; error: string }> {
  const note = (await getVisibleNote(input.organizationId, brandScope(input.brandId), input.noteId)) as { id: string; title: string; body: string; brandId: string | null } | null;
  if (!note || note.brandId !== input.brandId) return { ok: false, error: "That Brain note is not in this brand." };
  const db = tenantDb(input.organizationId);
  const sourceRef = `brain:${note.id}`;
  const pending = await db.supportProposal.findFirst({ where: { brandId: input.brandId, sourceRef, status: "pending" }, select: { id: true } });
  if (pending) return { ok: false, error: "That note is already waiting for review." };
  const text = noteToText(note.body).slice(0, 50_000);
  const gate = checkContent(`${note.title}\n${text}`);
  const created = await db.supportProposal.create({
    data: { organizationId: input.organizationId, brandId: input.brandId, kind: "brain-note", title: note.title.slice(0, 300), text, sourceRef, gateHits: gate.hits.map((h) => h.id), createdById: input.actorId },
    select: { id: true },
  });
  return { ok: true, id: created.id, blocked: gate.blocking.map((h) => h.label) };
}
