"use server";

import { appendPlatformAudit, rawPrisma, type Prisma } from "@pubcommand/db";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { cleanQuestion } from "../../../../../modules/knowledge/ask";
import { checkAttachment, embedMarkdown, MAX_ATTACHMENTS_PER_NOTE } from "../../../../../modules/knowledge/attachments";
import { normalizeFolder } from "../../../../../modules/knowledge/folders";
import { describeSecrets, findSecrets } from "../../../../../modules/knowledge/secrets";
import { MAX_VAULT_ZIP_BYTES } from "../brain/vault-import";
import { runMainAsk } from "./ask";
import { mainBrain } from "./db";
import { planMainFromZip, runMainVaultImport } from "./import";
import { uniqueMainSlug } from "./learn";
import { syncPushDown } from "./push";
import { requireBrainStaff } from "./staff";

const TITLE_MAX = 200;
const BODY_MAX = 1_000_000;
const UUID = /^[0-9a-f-]{36}$/i;

function field(formData: FormData, key: string, max = 300): string {
  return String(formData.get(key) ?? "").slice(0, max);
}

function go(path: string, kind: "error" | "notice", message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(message)}`);
}

function noteInput(formData: FormData, back: string) {
  const title = field(formData, "title", TITLE_MAX + 1).replace(/\s+/g, " ").trim();
  const body = field(formData, "body", BODY_MAX + 1).replace(/\r\n/g, "\n");
  if (!title) go(back, "error", "Give the note a title.");
  if (title.length > TITLE_MAX) go(back, "error", "That title is too long.");
  if (!body.trim()) go(back, "error", "Write something in the note.");
  if (body.length > BODY_MAX) go(back, "error", "That note is too long.");
  const secrets = findSecrets(`${title}\n${body}`);
  if (secrets.length) go(back, "error", `That note looks like it contains a secret (${describeSecrets(secrets)}). Remove it first.`);
  return { title, body, folder: normalizeFolder(field(formData, "folder", 400)) };
}

async function liveNote(formData: FormData) {
  const id = field(formData, "noteId", 40);
  const note = UUID.test(id) ? await mainBrain((tx) => tx.mainBrainNote.findFirst({ where: { id, deletedAt: null } })) : null;
  if (!note) go("/brain", "error", "That note no longer exists.");
  return note;
}

/** Re-sync brand copies of one note after a change, after the response. */
function resyncAfter(noteId: string) {
  after(() => syncPushDown({ noteIds: [noteId] }).then(() => undefined));
}

export async function createMainNote(formData: FormData) {
  const staff = await requireBrainStaff();
  const input = noteInput(formData, "/brain/new");
  const note = await mainBrain(async (tx) =>
    tx.mainBrainNote.create({
      data: {
        key: `note:${crypto.randomUUID()}`,
        title: input.title,
        slug: await uniqueMainSlug(tx, input.title),
        body: input.body,
        folder: input.folder,
        origin: "AUTHORED",
        source: "staff",
        createdById: staff.userId,
      },
    }),
  );
  await appendPlatformAudit({ actorId: staff.userId, action: "main_brain.note.created", targetType: "main_brain_note", targetId: note.id });
  go(`/brain/${note.id}`, "notice", "Note saved.");
}

export async function updateMainNote(formData: FormData) {
  const staff = await requireBrainStaff();
  const note = await liveNote(formData);
  const input = noteInput(formData, `/brain/${note.id}/edit`);
  await mainBrain((tx) =>
    tx.mainBrainNote.update({
      where: { id: note.id },
      // editedAt: from now on an app's later write does not overwrite this version.
      data: { ...input, updatedById: staff.userId, editedAt: new Date() },
    }),
  );
  await appendPlatformAudit({ actorId: staff.userId, action: "main_brain.note.updated", targetType: "main_brain_note", targetId: note.id });
  if (note.pushScope !== "NONE") resyncAfter(note.id);
  go(`/brain/${note.id}`, "notice", note.pushScope !== "NONE" ? "Note saved. Brand copies are being updated." : "Note saved.");
}

export async function deleteMainNote(formData: FormData) {
  const staff = await requireBrainStaff();
  const note = await liveNote(formData);
  await mainBrain((tx) => tx.mainBrainNote.update({ where: { id: note.id }, data: { deletedAt: new Date(), updatedById: staff.userId } }));
  await appendPlatformAudit({ actorId: staff.userId, action: "main_brain.note.deleted", targetType: "main_brain_note", targetId: note.id });
  // A deleted note is withdrawn from every brand it was pushed to.
  if (note.pushScope !== "NONE" || note.pushedAt) resyncAfter(note.id);
  go("/brain", "notice", `Deleted “${note.title}”.`);
}

/** Choose which brands get a note as a read-only best practice: none, all, or the ticked brands. */
export async function setPushDown(formData: FormData) {
  const staff = await requireBrainStaff();
  const note = await liveNote(formData);
  const back = `/brain/${note.id}`;
  const scopeValue = field(formData, "pushScope", 10);
  if (scopeValue !== "NONE" && scopeValue !== "ALL" && scopeValue !== "SELECTED") go(back, "error", "Choose who gets this note.");
  const brandIds = [...new Set(formData.getAll("brandId").map(String).filter((id) => UUID.test(id)))];
  const brands = scopeValue === "SELECTED" ? await rawPrisma().brand.findMany({ where: { id: { in: brandIds } }, select: { id: true, organizationId: true } }) : [];
  if (scopeValue === "SELECTED" && brands.length === 0) go(back, "error", "Tick at least one brand, or choose All brands.");
  await mainBrain(async (tx) => {
    await tx.mainBrainPushTarget.deleteMany({ where: { noteId: note.id } });
    if (brands.length) {
      await tx.mainBrainPushTarget.createMany({ data: brands.map((brand) => ({ noteId: note.id, brandId: brand.id, targetOrganizationId: brand.organizationId, createdById: staff.userId })) });
    }
    await tx.mainBrainNote.update({ where: { id: note.id }, data: { pushScope: scopeValue as "NONE" | "ALL" | "SELECTED", pushedAt: new Date(), pushedById: staff.userId } });
  });
  const summary = await syncPushDown({ noteIds: [note.id] });
  await appendPlatformAudit({
    actorId: staff.userId,
    action: "main_brain.note.pushed",
    targetType: "main_brain_note",
    targetId: note.id,
    metadata: { pushScope: scopeValue, brands: brands.length, ...summary } as unknown as Prisma.InputJsonValue,
  });
  const live = summary.created + summary.updated + summary.unchanged;
  go(
    back,
    "notice",
    scopeValue === "NONE" ? `No brand gets this note now${summary.removed ? ` (removed from ${summary.removed})` : ""}.` : `Pushed down: ${live} brand${live === 1 ? "" : "s"} have this note as a best practice.`,
  );
}

export async function askMainBrain(formData: FormData) {
  const staff = await requireBrainStaff();
  const question = cleanQuestion(field(formData, "question", 2000));
  if (question.length < 3) go("/brain/ask", "error", "Type a question.");
  const row = await mainBrain((tx) => tx.mainBrainQuestion.create({ data: { question, status: "QUEUED", askedById: staff.userId } }));
  after(() => runMainAsk({ questionId: row.id, actorId: staff.userId }));
  redirect(`/brain/ask/${row.id}`);
}

async function ownQuestion(formData: FormData, staffId: string) {
  const id = field(formData, "questionId", 40);
  const row = UUID.test(id) ? await mainBrain((tx) => tx.mainBrainQuestion.findFirst({ where: { id, askedById: staffId, hiddenAt: null } })) : null;
  if (!row) go("/brain/ask", "error", "That question is not in your history.");
  return row;
}

export async function retryMainQuestion(formData: FormData) {
  const staff = await requireBrainStaff();
  const row = await ownQuestion(formData, staff.userId);
  await mainBrain((tx) => tx.mainBrainQuestion.update({ where: { id: row.id }, data: { status: "QUEUED", error: null } }));
  after(() => runMainAsk({ questionId: row.id, actorId: staff.userId }));
  redirect(`/brain/ask/${row.id}`);
}

export async function toggleSavedMainQuestion(formData: FormData) {
  const staff = await requireBrainStaff();
  const row = await ownQuestion(formData, staff.userId);
  await mainBrain((tx) => tx.mainBrainQuestion.update({ where: { id: row.id }, data: { savedAt: row.savedAt ? null : new Date() } }));
  redirect(field(formData, "back", 10) === "list" ? "/brain/ask" : `/brain/ask/${row.id}`);
}

export async function hideMainQuestion(formData: FormData) {
  const staff = await requireBrainStaff();
  const row = await ownQuestion(formData, staff.userId);
  await mainBrain((tx) => tx.mainBrainQuestion.update({ where: { id: row.id }, data: { hiddenAt: new Date() } }));
  go("/brain/ask", "notice", "Removed from your history.");
}

export async function uploadMainVault(formData: FormData) {
  const staff = await requireBrainStaff();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) go("/brain/import", "error", "Choose a .zip of your Markdown vault.");
  if (!/\.zip$/i.test(file.name)) go("/brain/import", "error", "Upload a .zip file.");
  if (file.size > MAX_VAULT_ZIP_BYTES) go("/brain/import", "error", "That zip is over 55 MB. Split the vault into smaller zips.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const plan = await planMainFromZip(bytes);
  if (!plan.ok) go("/brain/import", "error", plan.error);
  const job = await mainBrain((tx) =>
    tx.mainBrainImport.create({
      data: {
        filename: file.name.slice(0, 200),
        size: file.size,
        data: bytes,
        status: "DRY_RUN",
        report: { ...plan.report, rootPrefix: plan.rootPrefix } as unknown as Prisma.InputJsonValue,
        createdById: staff.userId,
      },
    }),
  );
  await appendPlatformAudit({ actorId: staff.userId, action: "main_brain.vault.uploaded", targetType: "main_brain_import", targetId: job.id, metadata: { size: file.size } });
  redirect(`/brain/import/${job.id}`);
}

export async function confirmMainVaultImport(formData: FormData) {
  const staff = await requireBrainStaff();
  const id = field(formData, "importId", 40);
  const job = UUID.test(id) ? await mainBrain((tx) => tx.mainBrainImport.findUnique({ where: { id }, select: { id: true, status: true } })) : null;
  if (!job) go("/brain/import", "error", "That upload no longer exists.");
  if (job.status !== "DRY_RUN" && job.status !== "FAILED") redirect(`/brain/import/${job.id}`);
  await mainBrain((tx) => tx.mainBrainImport.update({ where: { id: job.id }, data: { status: "QUEUED", error: null } }));
  after(() => runMainVaultImport({ importId: job.id, actorId: staff.userId }));
  redirect(`/brain/import/${job.id}`);
}

export async function discardMainVaultImport(formData: FormData) {
  await requireBrainStaff();
  const id = field(formData, "importId", 40);
  if (UUID.test(id)) await mainBrain((tx) => tx.mainBrainImport.deleteMany({ where: { id, status: { in: ["DRY_RUN", "FAILED"] } } }));
  go("/brain/import", "notice", "Upload discarded. Nothing was imported.");
}

export async function uploadMainAttachment(formData: FormData) {
  const staff = await requireBrainStaff();
  const note = await liveNote(formData);
  const back = `/brain/${note.id}`;
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) go(back, "error", "Choose a file to attach.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkAttachment(file.name, bytes.length, bytes.subarray(0, 16));
  if (!check.ok) go(back, "error", check.error);
  const existing = await mainBrain((tx) => tx.mainBrainAttachment.findMany({ where: { noteId: note.id }, select: { filename: true } }));
  if (existing.length >= MAX_ATTACHMENTS_PER_NOTE) go(back, "error", "This note already has the most attachments allowed.");
  if (existing.some((row) => row.filename.toLowerCase() === check.filename.toLowerCase())) go(back, "error", `A file called “${check.filename}” is already attached.`);
  await mainBrain(async (tx) => {
    await tx.mainBrainAttachment.create({ data: { noteId: note.id, filename: check.filename, contentType: check.contentType, size: bytes.length, data: bytes, createdById: staff.userId } });
    await tx.mainBrainNote.update({ where: { id: note.id }, data: { body: `${note.body.replace(/\s+$/, "")}\n\n${embedMarkdown(check.filename)}\n`, updatedById: staff.userId, editedAt: new Date() } });
  });
  await appendPlatformAudit({ actorId: staff.userId, action: "main_brain.attachment.added", targetType: "main_brain_note", targetId: note.id, metadata: { size: bytes.length } });
  if (note.pushScope !== "NONE") resyncAfter(note.id);
  go(back, "notice", `Attached ${check.filename}.`);
}

export async function deleteMainAttachment(formData: FormData) {
  const staff = await requireBrainStaff();
  const note = await liveNote(formData);
  const id = field(formData, "attachmentId", 40);
  if (UUID.test(id)) await mainBrain((tx) => tx.mainBrainAttachment.deleteMany({ where: { id, noteId: note.id } }));
  await appendPlatformAudit({ actorId: staff.userId, action: "main_brain.attachment.deleted", targetType: "main_brain_note", targetId: note.id });
  if (note.pushScope !== "NONE") resyncAfter(note.id);
  go(`/brain/${note.id}`, "notice", "Attachment removed.");
}
