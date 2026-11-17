"use server";

import { runStructured } from "@pubcommand/ai";
import { appendPlatformAudit, Prisma } from "@pubcommand/db";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { factLabel, noteHash, REWRITE_SCHEMA, REWRITE_SYSTEM, replacePassage, rewritePrompt, type EntityKind } from "../../../../../modules/knowledge/conflicts";
import { describeSecrets, findSecrets } from "../../../../../modules/knowledge/secrets";
import { mainBrain } from "../main-brain/db";
import { syncPushDown } from "../main-brain/push";
import { requireBrainStaff } from "../main-brain/staff";
import { markQueued, recheckEntities } from "./check";

const UUID = /^[0-9a-f-]{36}$/i;
const BODY_MAX = 1_000_000;

function field(formData: FormData, key: string, max = 300): string {
  return String(formData.get(key) ?? "").slice(0, max);
}

function go(path: string, kind: "error" | "notice", message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(message)}`);
}

function kindOf(value: string): EntityKind | null {
  return value === "publication" || value === "editor" ? value : null;
}

const entityPath = (kind: string, id: string) => `/brain/conflicts/entity/${kind}/${id}`;

async function loadConflict(formData: FormData) {
  const id = field(formData, "conflictId", 40);
  const row = UUID.test(id) ? await mainBrain((tx) => tx.mainBrainConflict.findUnique({ where: { id } })) : null;
  if (!row) go("/brain/conflicts", "error", "That conflict no longer exists.");
  return row;
}

/** Re-check one entity after the response, using the AI when a key is set. */
function recheckAfter(kind: EntityKind, id: string, actorId: string) {
  after(() => recheckEntities({ only: { kind, id }, force: true, actorId }).then(() => undefined));
}

export async function recheckEntity(formData: FormData) {
  const staff = await requireBrainStaff();
  const kind = kindOf(field(formData, "kind", 20));
  const id = field(formData, "entityId", 40);
  if (!kind || !UUID.test(id)) go("/brain/conflicts", "error", "Choose a publication or editor.");
  await markQueued({ kind, id });
  recheckAfter(kind, id, staff.userId);
  await appendPlatformAudit({ actorId: staff.userId, action: "main_brain.conflicts.rechecked", targetType: kind, targetId: id });
  go(field(formData, "back", 300).startsWith("/brain/conflicts") ? field(formData, "back", 300) : entityPath(kind, id), "notice", "Re-checking now. This page refreshes when it is done.");
}

export async function recheckAll(formData: FormData) {
  const staff = await requireBrainStaff();
  const force = field(formData, "force", 4) === "1";
  await markQueued();
  after(() => recheckEntities({ force, actorId: staff.userId }).then(() => undefined));
  await appendPlatformAudit({ actorId: staff.userId, action: "main_brain.conflicts.rechecked_all", targetType: "main_brain", targetId: "conflicts", metadata: { force } });
  go("/brain/conflicts", "notice", force ? "Re-checking every publication and editor." : "Re-checking everything whose facts or notes changed.");
}

export async function dismissConflict(formData: FormData) {
  const staff = await requireBrainStaff();
  const row = await loadConflict(formData);
  const reason = field(formData, "reason", 1000).trim();
  if (!reason) go(`/brain/conflicts/${row.id}`, "error", "Say why this is not a conflict.");
  await mainBrain((tx) => tx.mainBrainConflict.update({ where: { id: row.id }, data: { status: "DISMISSED", resolution: "dismissed", reason, resolvedById: staff.userId, resolvedAt: new Date() } }));
  await appendPlatformAudit({ actorId: staff.userId, action: "main_brain.conflict.dismissed", targetType: "main_brain_conflict", targetId: row.id });
  go(`/brain/conflicts/${row.id}`, "notice", "Dismissed. It will not be raised again unless the fact or the note changes.");
}

export async function reopenConflict(formData: FormData) {
  const staff = await requireBrainStaff();
  const row = await loadConflict(formData);
  await mainBrain((tx) => tx.mainBrainConflict.update({ where: { id: row.id }, data: { status: "OPEN", resolution: null, reason: null, resolvedById: null, resolvedAt: null } }));
  await appendPlatformAudit({ actorId: staff.userId, action: "main_brain.conflict.reopened", targetType: "main_brain_conflict", targetId: row.id });
  go(`/brain/conflicts/${row.id}`, "notice", "Reopened.");
}

/** Admin decided the Brain is right: Setup must be fixed by the organization (never edited from here). */
export async function markSetupToFix(formData: FormData) {
  const staff = await requireBrainStaff();
  const row = await loadConflict(formData);
  const reason = field(formData, "reason", 1000).trim() || null;
  await mainBrain((tx) => tx.mainBrainConflict.update({ where: { id: row.id }, data: { status: "OPEN", resolution: "setup-to-fix", reason, resolvedById: staff.userId, resolvedAt: new Date() } }));
  await appendPlatformAudit({ actorId: staff.userId, action: "main_brain.conflict.setup_to_fix", targetType: "main_brain_conflict", targetId: row.id });
  go(`/brain/conflicts/${row.id}`, "notice", "Marked: Publication Setup needs fixing. It closes by itself once Setup is corrected and re-checked.");
}

async function liveNote(noteId: string, back: string) {
  const note = await mainBrain((tx) => tx.mainBrainNote.findFirst({ where: { id: noteId, deletedAt: null } }));
  if (!note) go(back, "error", "That note no longer exists.");
  return note;
}

async function saveNoteBody(input: { noteId: string; body: string; staffId: string; back: string }) {
  if (!input.body.trim()) go(input.back, "error", "The note cannot be empty.");
  if (input.body.length > BODY_MAX) go(input.back, "error", "That note is too long.");
  const secrets = findSecrets(input.body);
  if (secrets.length) go(input.back, "error", `That text looks like it contains a secret (${describeSecrets(secrets)}). Remove it first.`);
  const note = await mainBrain((tx) =>
    // editedAt: a staff edit wins over later app writes (same rule as the note editor).
    tx.mainBrainNote.update({ where: { id: input.noteId }, data: { body: input.body, updatedById: input.staffId, editedAt: new Date() }, select: { id: true, pushScope: true, pushedAt: true } }),
  );
  await appendPlatformAudit({ actorId: input.staffId, action: "main_brain.note.updated", targetType: "main_brain_note", targetId: note.id, metadata: { via: "conflicts" } });
  if (note.pushScope !== "NONE") after(() => syncPushDown({ noteIds: [note.id] }).then(() => undefined));
}

async function resolve(id: string, resolution: string, staffId: string, reason: string | null = null) {
  await mainBrain((tx) => tx.mainBrainConflict.update({ where: { id }, data: { status: "RESOLVED", resolution, reason, resolvedById: staffId, resolvedAt: new Date() } }));
  await appendPlatformAudit({ actorId: staffId, action: `main_brain.conflict.${resolution.replace(/-/g, "_")}`, targetType: "main_brain_conflict", targetId: id });
}

/** Rectify (a): replace the contradicting passage in the note with text a person wrote. */
export async function editPassage(formData: FormData) {
  const staff = await requireBrainStaff();
  const row = await loadConflict(formData);
  const back = `/brain/conflicts/${row.id}`;
  const replacement = field(formData, "passage", 20_000).replace(/\r\n/g, "\n").trim();
  if (!replacement) go(back, "error", "Write the corrected passage.");
  const note = await liveNote(row.noteId, back);
  const body = replacePassage(note.body, row.quote, replacement);
  if (body == null) go(back, "error", "That passage is no longer in the note (it changed since the check). Re-check, or edit the note itself.");
  await saveNoteBody({ noteId: note.id, body, staffId: staff.userId, back });
  await resolve(row.id, "note-edited", staff.userId);
  recheckAfter(row.entityKind as EntityKind, row.entityId, staff.userId);
  go(back, "notice", "Passage corrected in the main Brain. The entity is being re-checked.");
}

/** Rectify (a), AI-assisted: ask for a rewrite of the whole note. A person reviews it before anything is saved. */
export async function suggestRewrite(formData: FormData) {
  const staff = await requireBrainStaff();
  const row = await loadConflict(formData);
  const back = `/brain/conflicts/${row.id}`;
  const note = await liveNote(row.noteId, back);
  const base = noteHash(note.body);
  await mainBrain((tx) => tx.mainBrainConflict.update({ where: { id: row.id }, data: { suggestion: { status: "running", baseHash: base, at: new Date().toISOString() } } }));
  after(async () => {
    const result = await runStructured<{ body: string; summary: string }>({
      system: REWRITE_SYSTEM,
      input: [{ type: "text", text: rewritePrompt({ title: note.title, body: note.body, quote: row.quote, factLabel: factLabel(row.factKey), factValue: row.factValue, noteSays: row.noteSays }) }],
      schema: REWRITE_SCHEMA as unknown as Record<string, unknown>,
      effort: "low",
      maxTokens: 16000,
    });
    const suggestion =
      result.status === "ok" && result.data.body.trim()
        ? { status: "ok", body: result.data.body, summary: result.data.summary.slice(0, 500), baseHash: base, at: new Date().toISOString() }
        : { status: result.status === "ok" ? "failed" : result.status, reason: result.status === "ok" ? "The AI returned an empty note." : result.reason, baseHash: base, at: new Date().toISOString() };
    if (result.status === "ok" || (result.status === "failed" && result.usage)) {
      // Platform usage (no organization): server log only, as main-Brain Ask does.
      console.info("[main-brain] conflict-rewrite usage", staff.userId, row.id, JSON.stringify(result.usage));
    }
    await mainBrain((tx) => tx.mainBrainConflict.update({ where: { id: row.id }, data: { suggestion: suggestion as Prisma.InputJsonValue } }));
  });
  go(back, "notice", "Asking the AI for a rewrite. Review it before saving.");
}

/** Save the reviewed rewrite (the person may have edited it). */
export async function applyRewrite(formData: FormData) {
  const staff = await requireBrainStaff();
  const row = await loadConflict(formData);
  const back = `/brain/conflicts/${row.id}`;
  const note = await liveNote(row.noteId, back);
  const suggestion = (row.suggestion ?? null) as { status?: string; baseHash?: string } | null;
  if (suggestion?.status !== "ok") go(back, "error", "There is no rewrite to save. Ask for one first.");
  if (!suggestion.baseHash || suggestion.baseHash !== noteHash(note.body)) go(back, "error", "The note changed after the rewrite was suggested. Ask for a new rewrite.");
  const body = field(formData, "body", BODY_MAX + 1).replace(/\r\n/g, "\n");
  await saveNoteBody({ noteId: note.id, body, staffId: staff.userId, back });
  await mainBrain((tx) => tx.mainBrainConflict.update({ where: { id: row.id }, data: { suggestion: Prisma.DbNull } }));
  await resolve(row.id, "note-rewritten", staff.userId);
  recheckAfter(row.entityKind as EntityKind, row.entityId, staff.userId);
  go(back, "notice", "Note rewritten in the main Brain. The entity is being re-checked.");
}

export async function discardRewrite(formData: FormData) {
  await requireBrainStaff();
  const row = await loadConflict(formData);
  await mainBrain((tx) => tx.mainBrainConflict.update({ where: { id: row.id }, data: { suggestion: Prisma.DbNull } }));
  go(`/brain/conflicts/${row.id}`, "notice", "Suggestion discarded.");
}

/** Rectify (b): keep the note but flag it outdated; Ask and later checks skip it. */
export async function supersedeNote(formData: FormData) {
  const staff = await requireBrainStaff();
  const row = await loadConflict(formData);
  const back = `/brain/conflicts/${row.id}`;
  await liveNote(row.noteId, back);
  const reason = field(formData, "reason", 1000).trim() || `Contradicts Publication Setup (${factLabel(row.factKey)}: ${row.factValue.slice(0, 200)}).`;
  const now = new Date();
  await mainBrain(async (tx) => {
    await tx.mainBrainNoteFlag.upsert({
      where: { noteId: row.noteId },
      create: { noteId: row.noteId, supersededById: staff.userId, reason, conflictId: row.id },
      update: { supersededAt: now, supersededById: staff.userId, reason, conflictId: row.id },
    });
    // Every open conflict raised by this note is settled the same way.
    await tx.mainBrainConflict.updateMany({ where: { noteId: row.noteId, status: "OPEN" }, data: { status: "RESOLVED", resolution: "note-superseded", reason, resolvedById: staff.userId, resolvedAt: now } });
  });
  await appendPlatformAudit({ actorId: staff.userId, action: "main_brain.note.superseded", targetType: "main_brain_note", targetId: row.noteId, metadata: { conflictId: row.id } });
  go(back, "notice", "Note marked outdated. It stays in the main Brain, flagged, and Ask no longer uses it.");
}

export async function restoreNote(formData: FormData) {
  const staff = await requireBrainStaff();
  const noteId = field(formData, "noteId", 40);
  const back = field(formData, "back", 300).startsWith("/brain") ? field(formData, "back", 300) : `/brain/${noteId}`;
  if (!UUID.test(noteId)) go("/brain/conflicts", "error", "Unknown note.");
  await mainBrain((tx) => tx.mainBrainNoteFlag.deleteMany({ where: { noteId } }));
  await appendPlatformAudit({ actorId: staff.userId, action: "main_brain.note.restored", targetType: "main_brain_note", targetId: noteId });
  go(back, "notice", "No longer marked outdated. Ask uses it again; the next check compares it again.");
}
