"use server";

import { appendOrgAudit, tenantDb, type Prisma } from "@pubcommand/db";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { cleanQuestion } from "../../../../../modules/knowledge/ask";
import { normalizeFolder } from "../../../../../modules/knowledge/folders";
import { describeSecrets, findSecrets } from "../../../../../modules/knowledge/secrets";
import { canEditNoteInScope, scopeBrandId, type BrainScope } from "../../../../../modules/knowledge/visibility";
import { runAsk } from "./ask";
import { brainAction, brainHref, brainPromptContext, type BrainContext } from "./context";
import { getVisibleNote, uniqueSlug } from "./notes";
import { MAX_VAULT_ZIP_BYTES, planFromZip, runVaultImport } from "./vault-import";

const TITLE_MAX = 200;
const BODY_MAX = 1_000_000;

function field(formData: FormData, key: string, max = 300): string {
  return String(formData.get(key) ?? "").slice(0, max);
}

function fail(ctx: BrainContext, path: string, error: string): never {
  redirect(brainHref(path, ctx.brain, { error }));
}

function noteInput(ctx: BrainContext, formData: FormData, back: string) {
  const title = field(formData, "title", TITLE_MAX + 1).replace(/\s+/g, " ").trim();
  const body = field(formData, "body", BODY_MAX + 1).replace(/\r\n/g, "\n");
  if (!title) fail(ctx, back, "Give the note a title.");
  if (title.length > TITLE_MAX) fail(ctx, back, "That title is too long.");
  if (!body.trim()) fail(ctx, back, "Write something in the note.");
  if (body.length > BODY_MAX) fail(ctx, back, "That note is too long.");
  const secrets = findSecrets(`${title}\n${body}`);
  if (secrets.length) fail(ctx, back, `That note looks like it contains a secret (${describeSecrets(secrets)}). Remove it first.`);
  return { title, body, folder: normalizeFolder(field(formData, "folder", 400)) };
}

async function editableNote(ctx: BrainContext, formData: FormData) {
  const note = await getVisibleNote(ctx.resolved.id, ctx.brain, field(formData, "noteId", 40));
  if (!note) fail(ctx, "/knowledge", "That note no longer exists.");
  if (!canEditNoteInScope(ctx.brain, note)) fail(ctx, `/knowledge/${note.id}`, "This note belongs to another Brain. Edit it there.");
  return note;
}

export async function createNote(formData: FormData) {
  const ctx = await brainAction(formData, "write");
  const input = noteInput(ctx, formData, "/knowledge/new");
  const note = await tenantDb(ctx.resolved.id).knowledgePage.create({
    data: {
      organizationId: ctx.resolved.id,
      brandId: scopeBrandId(ctx.brain),
      title: input.title,
      slug: await uniqueSlug(ctx.resolved.id, input.title),
      body: input.body,
      folder: input.folder,
      source: "member",
      visibility: "PRIVATE",
      createdById: ctx.auth.user.id,
    },
  });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "brain.note.created", targetType: "knowledge_page", targetId: note.id });
  redirect(brainHref(`/knowledge/${note.id}`, ctx.brain, { notice: "Note saved." }));
}

export async function updateNote(formData: FormData) {
  const ctx = await brainAction(formData, "write");
  const note = await editableNote(ctx, formData);
  const input = noteInput(ctx, formData, `/knowledge/${note.id}/edit`);
  await tenantDb(ctx.resolved.id).knowledgePage.updateMany({
    where: { id: note.id },
    data: { ...input, updatedById: ctx.auth.user.id },
  });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "brain.note.updated", targetType: "knowledge_page", targetId: note.id });
  redirect(brainHref(`/knowledge/${note.id}`, ctx.brain, { notice: "Note saved." }));
}

export async function moveNote(formData: FormData) {
  const ctx = await brainAction(formData, "write");
  const note = await editableNote(ctx, formData);
  const folder = normalizeFolder(field(formData, "folder", 400));
  await tenantDb(ctx.resolved.id).knowledgePage.updateMany({ where: { id: note.id }, data: { folder, updatedById: ctx.auth.user.id } });
  await appendOrgAudit(ctx.resolved.id, {
    actorId: ctx.auth.user.id,
    action: "brain.note.moved",
    targetType: "knowledge_page",
    targetId: note.id,
    metadata: { from: note.folder, to: folder },
  });
  redirect(brainHref(`/knowledge/${note.id}`, ctx.brain, { notice: folder ? `Moved to ${folder}.` : "Moved to the top level." }));
}

export async function deleteNote(formData: FormData) {
  const ctx = await brainAction(formData, "write");
  const note = await editableNote(ctx, formData);
  await tenantDb(ctx.resolved.id).knowledgePage.updateMany({ where: { id: note.id }, data: { deletedAt: new Date(), updatedById: ctx.auth.user.id } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "brain.note.deleted", targetType: "knowledge_page", targetId: note.id });
  redirect(brainHref("/knowledge", ctx.brain, { notice: `Deleted “${note.title}”.` }));
}

export async function setNoteShared(formData: FormData) {
  const ctx = await brainAction(formData, "share");
  const note = await editableNote(ctx, formData);
  const shared = field(formData, "shared", 5) === "true";
  await tenantDb(ctx.resolved.id).knowledgePage.updateMany({
    where: { id: note.id },
    data: shared
      ? { visibility: "SHARED", sharedAt: new Date(), sharedById: ctx.auth.user.id }
      : { visibility: "PRIVATE", sharedAt: null, sharedById: null },
  });
  await appendOrgAudit(ctx.resolved.id, {
    actorId: ctx.auth.user.id,
    action: shared ? "brain.note.shared" : "brain.note.unshared",
    targetType: "knowledge_page",
    targetId: note.id,
    metadata: { brandId: note.brandId },
  });
  redirect(
    brainHref(`/knowledge/${note.id}`, ctx.brain, {
      notice: shared ? "Shared: every brand's mini-brain can now see this note." : "No longer shared. Only its own Brain sees it.",
    }),
  );
}

function startAsk(ctx: BrainContext, questionId: string) {
  const scope: BrainScope = ctx.brain;
  const brandContext = brainPromptContext(ctx);
  after(() =>
    runAsk({
      organizationId: ctx.resolved.id,
      questionId,
      scope,
      scopeLabel: ctx.scopeLabel,
      brandContext,
      brandNames: ctx.brandNames,
      actorId: ctx.auth.user.id,
    }),
  );
}

export async function askBrain(formData: FormData) {
  const ctx = await brainAction(formData, "read");
  const question = cleanQuestion(field(formData, "question", 2000));
  if (question.length < 3) fail(ctx, "/knowledge/ask", "Type a question.");
  const row = await tenantDb(ctx.resolved.id).knowledgeQuestion.create({
    data: { organizationId: ctx.resolved.id, brandId: scopeBrandId(ctx.brain), question, status: "QUEUED", createdById: ctx.auth.user.id },
  });
  startAsk(ctx, row.id);
  redirect(brainHref(`/knowledge/ask/${row.id}`, ctx.brain));
}

export async function retryQuestion(formData: FormData) {
  const ctx = await brainAction(formData, "read");
  const id = field(formData, "questionId", 40);
  const row = await tenantDb(ctx.resolved.id).knowledgeQuestion.findFirst({ where: { id, brandId: scopeBrandId(ctx.brain) } });
  if (!row) fail(ctx, "/knowledge/ask", "That question is not in this Brain.");
  await tenantDb(ctx.resolved.id).knowledgeQuestion.updateMany({ where: { id: row.id }, data: { status: "QUEUED", error: null } });
  startAsk(ctx, row.id);
  redirect(brainHref(`/knowledge/ask/${row.id}`, ctx.brain));
}

/** Where an import lands: "main" or a brand id this user may use. */
function importTarget(ctx: BrainContext, value: string): string | null | undefined {
  if (value === "main") return ctx.mainAllowed ? null : undefined;
  const brand = ctx.brands.find((item) => item.id === value);
  if (!brand) return undefined;
  if (!ctx.mainAllowed && brand.id !== ctx.scopeBrand?.id) return undefined;
  return brand.id;
}

export async function uploadVault(formData: FormData) {
  const ctx = await brainAction(formData, "write");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) fail(ctx, "/knowledge/import", "Choose a .zip of your Markdown vault.");
  if (!/\.zip$/i.test(file.name)) fail(ctx, "/knowledge/import", "Upload a .zip file.");
  if (file.size > MAX_VAULT_ZIP_BYTES) fail(ctx, "/knowledge/import", "That zip is over 55 MB. Split the vault into smaller zips.");
  const target = importTarget(ctx, field(formData, "target", 60));
  if (target === undefined) fail(ctx, "/knowledge/import", "Choose a Brain you can import into.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const plan = await planFromZip(ctx.resolved.id, bytes, target);
  if (!plan.ok) fail(ctx, "/knowledge/import", plan.error);
  const job = await tenantDb(ctx.resolved.id).knowledgeImport.create({
    data: {
      organizationId: ctx.resolved.id,
      brandId: target,
      filename: file.name.slice(0, 200),
      size: file.size,
      data: bytes,
      status: "DRY_RUN",
      report: { ...plan.report, rootPrefix: plan.rootPrefix } as unknown as Prisma.InputJsonValue,
      createdById: ctx.auth.user.id,
    },
  });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "brain.vault.uploaded", targetType: "knowledge_import", targetId: job.id, metadata: { brandId: target, size: file.size } });
  redirect(brainHref(`/knowledge/import/${job.id}`, ctx.brain));
}

export async function confirmVaultImport(formData: FormData) {
  const ctx = await brainAction(formData, "write");
  const db = tenantDb(ctx.resolved.id);
  const job = await db.knowledgeImport.findFirst({ where: { id: field(formData, "importId", 40) }, select: { id: true, brandId: true, status: true } });
  if (!job) fail(ctx, "/knowledge/import", "That upload no longer exists.");
  if (importTarget(ctx, job.brandId ?? "main") === undefined) fail(ctx, "/knowledge/import", "You cannot import into that Brain.");
  if (job.status !== "DRY_RUN" && job.status !== "FAILED") redirect(brainHref(`/knowledge/import/${job.id}`, ctx.brain));
  await db.knowledgeImport.updateMany({ where: { id: job.id }, data: { status: "QUEUED", error: null } });
  const actorId = ctx.auth.user.id;
  after(() => runVaultImport({ organizationId: ctx.resolved.id, importId: job.id, actorId }));
  redirect(brainHref(`/knowledge/import/${job.id}`, ctx.brain));
}

export async function discardVaultImport(formData: FormData) {
  const ctx = await brainAction(formData, "write");
  await tenantDb(ctx.resolved.id).knowledgeImport.deleteMany({ where: { id: field(formData, "importId", 40), status: { in: ["DRY_RUN", "FAILED"] } } });
  redirect(brainHref("/knowledge/import", ctx.brain, { notice: "Upload discarded. Nothing was imported." }));
}
