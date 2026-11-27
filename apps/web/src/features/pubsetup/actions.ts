"use server";

import { appendOrgAudit, syncBrandLook, tenantDb, type Prisma } from "@pubcommand/db";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { BRANDING_FIELDS, firstError, parseFields, type FieldValues } from "../../../../../modules/pubsetup/fields";
import { UUID, brandDefaultsAction, pubsetupAction, withMessage, type PubsetupCtx } from "./guard";
import { uploadedImageType } from "./image-type";
import { logoColumns, storedLogos } from "./logo-upload";
import { notifyBrandSites } from "../websites/api";
import { refreshAllPublications } from "./teach";
import { linkEditorRecord, linkedEditorIds as editorsOf, linkedPublicationIds as publicationsOf, roleOrLead, saveEditorRecord, savePublicationRecord, scheduleRefresh as refreshLater, unlinkEditorRecord, type PubsetupScope } from "./records";

const PUB_BRANDING_FIELDS = BRANDING_FIELDS.filter((def) => def.key !== "tagline");
const LOGO_SELECT = { logoData: true, logoMime: true, logoFilename: true, logoOnDarkData: true, logoOnDarkMime: true, logoOnDarkFilename: true } as const;

function withNote(text: string, note: string | null): string {
  return note ? `${text} ${note}` : text;
}

function scopeOf(ctx: PubsetupCtx): PubsetupScope {
  return { organizationId: ctx.resolved.id, brandId: ctx.brand.id, actorId: ctx.actorId };
}

function audit(ctx: PubsetupCtx, action: string, targetType: string, targetId: string, metadata?: Prisma.InputJsonValue) {
  return appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action, targetType, targetId, ...(metadata ? { metadata } : {}) });
}

function idOf(formData: FormData, key: string): string {
  const value = String(formData.get(key) ?? "").trim();
  return UUID.test(value) ? value : "";
}

/** An uploaded image as `<prefix>Filename/Mime/Data` columns, a removal, or nothing. */
async function imageColumns(formData: FormData, input: string, prefix: string, back: string, maxMb: number): Promise<Record<string, string | Uint8Array | null>> {
  const file = formData.get(input);
  if (file instanceof File && file.size > 0) {
    if (file.size > maxMb * 1024 * 1024) redirect(withMessage(back, "error", `Images must be under ${maxMb} MB.`));
    const data = new Uint8Array(await file.arrayBuffer());
    const mime = uploadedImageType(file, data);
    if (!mime) redirect(withMessage(back, "error", "Upload a PNG, JPG, GIF, WebP or SVG image."));
    return { [`${prefix}Filename`]: file.name.slice(0, 200), [`${prefix}Mime`]: mime, [`${prefix}Data`]: data };
  }
  if (formData.get(`remove-${input}`) === "on") return { [`${prefix}Filename`]: null, [`${prefix}Mime`]: null, [`${prefix}Data`]: null };
  return {};
}

function str(values: FieldValues, key: string): string | null {
  const value = values[key];
  return typeof value === "string" && value ? value : null;
}

// ── Publications ───────────────────────────────────────────────────────────

export async function savePublication(formData: FormData) {
  const id = idOf(formData, "publicationId");
  const back = id ? `/settings/publication-setup/publications/${id}/edit` : "/settings/publication-setup/publications/new";
  const ctx = await pubsetupAction(back);
  const db = tenantDb(ctx.resolved.id);
  // Uploads first (they redirect with their own message); the rules are shared with AI agents (records.ts).
  const logos = await logoColumns(formData, back, async () => storedLogos(id ? await db.calendarPublication.findFirst({ where: { id, brandId: ctx.brand.id }, select: LOGO_SELECT }) : null));
  const images = { ...logos.data, ...(await imageColumns(formData, "cover", "cover", back, 5)) };
  const result = await savePublicationRecord(scopeOf(ctx), formData, id || null, images);
  if (!result.ok) redirect(withMessage(result.error === "That publication no longer exists." ? "/settings/publication-setup" : back, "error", result.error));
  redirect(withMessage(`/settings/publication-setup/publications/${result.id}`, "notice", withNote(`${result.name} saved.`, logos.note)));
}

export async function setPublicationArchived(formData: FormData) {
  const id = idOf(formData, "publicationId");
  const archive = formData.get("archive") === "1";
  const ctx = await pubsetupAction(`/settings/publication-setup/publications/${id}`);
  const db = tenantDb(ctx.resolved.id);
  const pub = id ? await db.calendarPublication.findFirst({ where: { id, brandId: ctx.brand.id }, select: { id: true, name: true, status: true } }) : null;
  if (!pub) redirect(withMessage("/settings/publication-setup", "error", "That publication no longer exists."));
  await db.calendarPublication.updateMany({
    where: { id: pub.id },
    // Archived publications drop out of every picker but old issues and stats keep them.
    data: archive ? { deletedAt: new Date(), active: false, updatedById: ctx.actorId } : { deletedAt: null, active: pub.status !== "retired", updatedById: ctx.actorId },
  });
  await audit(ctx, archive ? "pubsetup.publication.archived" : "pubsetup.publication.restored", "calendar_publication", pub.id);
  refreshLater(scopeOf(ctx), [pub.id], await editorsOf(ctx.resolved.id, pub.id));
  redirect(withMessage(archive ? "/settings/publication-setup?show=archived" : `/settings/publication-setup/publications/${pub.id}`, "notice", `${pub.name} ${archive ? "archived" : "restored"}.`));
}

export async function savePublicationBranding(formData: FormData) {
  const id = idOf(formData, "publicationId");
  const back = `/settings/publication-setup/publications/${id}/branding`;
  const ctx = await pubsetupAction(back);
  const db = tenantDb(ctx.resolved.id);
  const pub = id ? await db.calendarPublication.findFirst({ where: { id, brandId: ctx.brand.id }, select: { id: true, name: true } }) : null;
  if (!pub) redirect(withMessage("/settings/publication-setup", "error", "That publication no longer exists."));
  const parsed = parseFields(PUB_BRANDING_FIELDS, formData);
  if (!parsed.ok) redirect(withMessage(back, "error", firstError(PUB_BRANDING_FIELDS, parsed.errors)));
  const v = parsed.values;
  const data = Object.fromEntries(PUB_BRANDING_FIELDS.map((def) => [def.key, str(v, def.key)]));
  const logos = await logoColumns(formData, back, async () => storedLogos(await db.calendarPublication.findFirst({ where: { id: pub.id }, select: LOGO_SELECT })));
  await db.calendarPublication.updateMany({ where: { id: pub.id }, data: { ...data, ...logos.data, updatedById: ctx.actorId } });
  await audit(ctx, "pubsetup.publication.branding", "calendar_publication", pub.id);
  refreshLater(scopeOf(ctx), [pub.id], []);
  redirect(withMessage(back, "notice", withNote("Branding saved.", logos.note)));
}

export async function saveBrandDefaults(formData: FormData) {
  const { ctx, back } = await brandDefaultsAction(String(formData.get("brandId") ?? ""));
  const db = tenantDb(ctx.resolved.id);
  const parsed = parseFields(BRANDING_FIELDS, formData);
  if (!parsed.ok) redirect(withMessage(back, "error", firstError(BRANDING_FIELDS, parsed.errors)));
  const v = parsed.values;
  const logos = await logoColumns(formData, back, async () => storedLogos(await db.pubBrandBranding.findFirst({ where: { brandId: ctx.brand.id }, select: LOGO_SELECT })));
  const data = {
    ...Object.fromEntries(BRANDING_FIELDS.map((def) => [def.key, str(v, def.key)])),
    ...logos.data,
    updatedById: ctx.actorId,
  };
  const existing = await db.pubBrandBranding.findFirst({ where: { brandId: ctx.brand.id }, select: { id: true } });
  if (existing) await db.pubBrandBranding.updateMany({ where: { id: existing.id }, data });
  else await db.pubBrandBranding.create({ data: { organizationId: ctx.resolved.id, brandId: ctx.brand.id, ...data } });
  await audit(ctx, "pubsetup.brand.branding", "brand", ctx.brand.id);
  // Form themes and Mini-Blogs that use the brand look pick up the new colors, logo and size now.
  const synced = await syncBrandLook(ctx.resolved.id, ctx.brand.id).catch((error: unknown) => {
    console.error("[pubsetup] brand look sync failed", error);
    return { themes: 0, sites: 0 };
  });
  const base = { organizationId: ctx.resolved.id, brandId: ctx.brand.id, actorId: ctx.actorId };
  after(async () => {
    await refreshAllPublications(base);
    await notifyBrandSites(base.organizationId, base.brandId);
  });
  const followers = synced.themes + synced.sites;
  const followNote = followers ? " Form themes and Mini-Blogs that use the brand look were updated." : "";
  redirect(withMessage(back, "notice", withNote(`Brand defaults saved. Publications that leave a field blank use these.${followNote}`, logos.note)));
}

// ── Editors ────────────────────────────────────────────────────────────────

export async function saveEditor(formData: FormData) {
  const id = idOf(formData, "editorId");
  const back = id ? `/settings/publication-setup/editors/${id}/edit` : "/settings/publication-setup/editors/new";
  const ctx = await pubsetupAction(back);
  const photo = await imageColumns(formData, "photo", "photo", back, 3);
  const result = await saveEditorRecord(scopeOf(ctx), formData, id || null, photo);
  if (!result.ok) redirect(withMessage(result.error === "That editor no longer exists." ? "/settings/publication-setup/editors" : back, "error", result.error));
  redirect(withMessage(`/settings/publication-setup/editors/${result.id}`, "notice", `${result.name} saved.`));
}

export async function setEditorArchived(formData: FormData) {
  const id = idOf(formData, "editorId");
  const archive = formData.get("archive") === "1";
  const ctx = await pubsetupAction(`/settings/publication-setup/editors/${id}`);
  const db = tenantDb(ctx.resolved.id);
  const editor = id ? await db.pubEditor.findFirst({ where: { id, brandId: ctx.brand.id }, select: { id: true, name: true } }) : null;
  if (!editor) redirect(withMessage("/settings/publication-setup/editors", "error", "That editor no longer exists."));
  await db.pubEditor.updateMany({ where: { id: editor.id }, data: { deletedAt: archive ? new Date() : null, updatedById: ctx.actorId } });
  await audit(ctx, archive ? "pubsetup.editor.archived" : "pubsetup.editor.restored", "pubsetup_editor", editor.id);
  refreshLater(scopeOf(ctx), await publicationsOf(ctx.resolved.id, editor.id), [editor.id]);
  redirect(withMessage(archive ? "/settings/publication-setup/editors?show=archived" : `/settings/publication-setup/editors/${editor.id}`, "notice", `${editor.name} ${archive ? "archived" : "restored"}.`));
}

// ── Who writes what ────────────────────────────────────────────────────────

export async function linkEditor(formData: FormData) {
  const publicationId = idOf(formData, "publicationId");
  const editorId = idOf(formData, "editorId");
  const back = String(formData.get("back") ?? "") === "editor" ? `/settings/publication-setup/editors/${editorId}` : `/settings/publication-setup/publications/${publicationId}`;
  const ctx = await pubsetupAction(back);
  if (!publicationId || !editorId) redirect(withMessage(back, "error", "Pick a publication and an editor."));
  const result = await linkEditorRecord(scopeOf(ctx), publicationId, editorId, roleOrLead(formData.get("role")));
  if (!result.ok) redirect(withMessage(back, "error", "Pick a publication and an editor."));
  redirect(withMessage(back, "notice", `${result.editor} saved as ${result.role === "lead" ? "lead editor" : result.role}.`));
}

export async function unlinkEditor(formData: FormData) {
  const publicationId = idOf(formData, "publicationId");
  const editorId = idOf(formData, "editorId");
  const back = String(formData.get("back") ?? "") === "editor" ? `/settings/publication-setup/editors/${editorId}` : `/settings/publication-setup/publications/${publicationId}`;
  const ctx = await pubsetupAction(back);
  if (!publicationId || !editorId || !(await unlinkEditorRecord(scopeOf(ctx), publicationId, editorId))) redirect(withMessage(back, "error", "That link no longer exists."));
  redirect(withMessage(back, "notice", "Removed."));
}
