"use server";

import { appendOrgAudit, syncBrandLook, tenantDb, type Prisma } from "@pubcommand/db";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { BRANDING_FIELDS, EDITOR_FIELDS, EDITOR_ROLES, PUBLICATION_FIELDS, firstError, parseFields, uniqueSlug, type FieldValues } from "../../../../../modules/pubsetup/fields";
import { UUID, brandDefaultsAction, pubsetupAction, withMessage, type PubsetupCtx } from "./guard";
import { uploadedImageType } from "./image-type";
import { logoColumns, storedLogos } from "./logo-upload";
import { notifyBrandSites } from "../websites/api";
import { refreshAllPublications, refreshEditor, refreshPublication } from "./teach";

const PUB_BRANDING_FIELDS = BRANDING_FIELDS.filter((def) => def.key !== "tagline");
const LOGO_SELECT = { logoData: true, logoMime: true, logoFilename: true, logoOnDarkData: true, logoOnDarkMime: true, logoOnDarkFilename: true } as const;

function withNote(text: string, note: string | null): string {
  return note ? `${text} ${note}` : text;
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

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? [])) as Prisma.InputJsonValue;
}

function scheduleRefresh(ctx: PubsetupCtx, publicationIds: string[], editorIds: string[]) {
  const base = { organizationId: ctx.resolved.id, brandId: ctx.brand.id, actorId: ctx.actorId };
  after(async () => {
    for (const publicationId of publicationIds) await refreshPublication({ ...base, publicationId });
    for (const editorId of editorIds) await refreshEditor({ ...base, editorId });
    // Websites show publications and editors: refresh the brand's separately hosted sites.
    await notifyBrandSites(base.organizationId, base.brandId);
  });
}

async function linkedEditorIds(ctx: PubsetupCtx, publicationId: string): Promise<string[]> {
  const links = await tenantDb(ctx.resolved.id).pubPublicationEditor.findMany({ where: { publicationId }, select: { editorId: true } });
  return links.map((l) => l.editorId);
}

async function linkedPublicationIds(ctx: PubsetupCtx, editorId: string): Promise<string[]> {
  const links = await tenantDb(ctx.resolved.id).pubPublicationEditor.findMany({ where: { editorId }, select: { publicationId: true } });
  return links.map((l) => l.publicationId);
}

// ── Publications ───────────────────────────────────────────────────────────

export async function savePublication(formData: FormData) {
  const id = idOf(formData, "publicationId");
  const back = id ? `/settings/publication-setup/publications/${id}/edit` : "/settings/publication-setup/publications/new";
  const ctx = await pubsetupAction(back);
  const db = tenantDb(ctx.resolved.id);
  const parsed = parseFields(PUBLICATION_FIELDS, formData);
  if (!parsed.ok) redirect(withMessage(back, "error", firstError(PUBLICATION_FIELDS, parsed.errors)));
  const v = parsed.values;
  const code = str(v, "code")!;
  const existing = id ? await db.calendarPublication.findFirst({ where: { id, brandId: ctx.brand.id } }) : null;
  if (id && !existing) redirect(withMessage("/settings/publication-setup", "error", "That publication no longer exists."));

  const codeClash = await db.calendarPublication.findFirst({ where: { brandId: ctx.brand.id, code, ...(id ? { id: { not: id } } : {}) }, select: { name: true, deletedAt: true } });
  if (codeClash) redirect(withMessage(back, "error", `Code ${code} is already used by ${codeClash.name}${codeClash.deletedAt ? " (archived: restore it instead)" : ""}.`));

  const typedSlug = String(formData.get("slug") ?? "").trim() !== "";
  let slug = str(v, "slug") ?? "publication";
  const others = await db.calendarPublication.findMany({ where: { brandId: ctx.brand.id, ...(id ? { id: { not: id } } : {}) }, select: { slug: true } });
  const taken = others.map((o) => o.slug).filter((s): s is string => Boolean(s));
  if (taken.includes(slug)) {
    if (typedSlug) redirect(withMessage(back, "error", `URL name "${slug}" is already used by another publication.`));
    slug = uniqueSlug(slug, taken);
  }

  // A category must be one of this brand's.
  const categoryId = str(v, "categoryId");
  if (categoryId && !(await db.pubCategory.findFirst({ where: { id: categoryId, brandId: ctx.brand.id }, select: { id: true } }))) {
    redirect(withMessage(back, "error", "That category no longer exists. Pick another."));
  }

  const status = str(v, "status") ?? "active";
  // pub_type (the old Type) is no longer edited here: it is left as it is.
  const data = {
    code,
    name: str(v, "name")!,
    slug,
    tagline: str(v, "tagline"),
    categoryId,
    tier: str(v, "tier"),
    frequency: str(v, "frequency"),
    status,
    active: status !== "retired" && !existing?.deletedAt,
    launchDate: str(v, "launchDate") ? new Date(`${str(v, "launchDate")}T00:00:00Z`) : null,
    color: str(v, "color")!,
    sortOrder: typeof v.sortOrder === "number" ? v.sortOrder : 0,
    description: str(v, "description"),
    longDescription: str(v, "longDescription"),
    positioning: str(v, "positioning"),
    audience: str(v, "audience"),
    deliverables: (v.deliverables as string[]) ?? [],
    retailPrice: str(v, "retailPrice"),
    lifetimePrice: str(v, "lifetimePrice"),
    salePrice: str(v, "salePrice"),
    pricingNotes: str(v, "pricingNotes"),
    offers: json(v.offers),
    websiteUrl: str(v, "websiteUrl"),
    signupUrl: str(v, "signupUrl"),
    archiveUrl: str(v, "archiveUrl"),
    sampleIssues: json(v.sampleIssues),
    faq: json(v.faq),
    voiceNotes: str(v, "voiceNotes"),
    complianceNotes: str(v, "complianceNotes"),
    updatedById: ctx.actorId,
  };
  const logos = await logoColumns(formData, back, async () => storedLogos(id ? await db.calendarPublication.findFirst({ where: { id, brandId: ctx.brand.id }, select: LOGO_SELECT }) : null));
  const images = {
    ...logos.data,
    ...(await imageColumns(formData, "cover", "cover", back, 5)),
  };

  let publicationId = id;
  if (existing) {
    await db.calendarPublication.updateMany({ where: { id: existing.id }, data: { ...data, ...images } });
    if (existing.code !== code) {
      // Issues point at a publication by code: keep them attached when the code changes.
      await db.calendarIssue.updateMany({ where: { brandId: ctx.brand.id, publicationCode: existing.code }, data: { publicationCode: code } });
    }
    await audit(ctx, "pubsetup.publication.updated", "calendar_publication", existing.id, existing.code !== code ? { from: existing.code, to: code } : undefined);
  } else {
    const created = await db.calendarPublication.create({
      data: { organizationId: ctx.resolved.id, brandId: ctx.brand.id, ...data, ...images, createdById: ctx.actorId },
      select: { id: true },
    });
    publicationId = created.id;
    await audit(ctx, "pubsetup.publication.created", "calendar_publication", created.id, { code });
  }
  scheduleRefresh(ctx, [publicationId], await linkedEditorIds(ctx, publicationId));
  redirect(withMessage(`/settings/publication-setup/publications/${publicationId}`, "notice", withNote(`${data.name} saved.`, logos.note)));
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
  scheduleRefresh(ctx, [pub.id], await linkedEditorIds(ctx, pub.id));
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
  scheduleRefresh(ctx, [pub.id], []);
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
  const db = tenantDb(ctx.resolved.id);
  const parsed = parseFields(EDITOR_FIELDS, formData);
  if (!parsed.ok) redirect(withMessage(back, "error", firstError(EDITOR_FIELDS, parsed.errors)));
  const v = parsed.values;
  const existing = id ? await db.pubEditor.findFirst({ where: { id, brandId: ctx.brand.id }, select: { id: true } }) : null;
  if (id && !existing) redirect(withMessage("/settings/publication-setup/editors", "error", "That editor no longer exists."));

  const typedSlug = String(formData.get("slug") ?? "").trim() !== "";
  let slug = str(v, "slug") ?? "editor";
  const others = await db.pubEditor.findMany({ where: { brandId: ctx.brand.id, ...(id ? { id: { not: id } } : {}) }, select: { slug: true } });
  const taken = others.map((o) => o.slug);
  if (taken.includes(slug)) {
    if (typedSlug) redirect(withMessage(back, "error", `URL name "${slug}" is already used by another editor.`));
    slug = uniqueSlug(slug, taken);
  }
  const data = {
    name: str(v, "name")!,
    slug,
    title: str(v, "title"),
    status: str(v, "status") ?? "active",
    email: str(v, "email"),
    sortOrder: typeof v.sortOrder === "number" ? v.sortOrder : 0,
    shortBio: str(v, "shortBio"),
    longBio: str(v, "longBio"),
    credentials: str(v, "credentials"),
    trackRecord: str(v, "trackRecord"),
    specialties: (v.specialties as string[]) ?? [],
    socialLinks: json(v.socialLinks),
    voiceNotes: str(v, "voiceNotes"),
    updatedById: ctx.actorId,
    ...(await imageColumns(formData, "photo", "photo", back, 3)),
  };
  let editorId = id;
  if (existing) {
    await db.pubEditor.updateMany({ where: { id: existing.id }, data });
    await audit(ctx, "pubsetup.editor.updated", "pubsetup_editor", existing.id);
  } else {
    const created = await db.pubEditor.create({ data: { organizationId: ctx.resolved.id, brandId: ctx.brand.id, ...data, createdById: ctx.actorId }, select: { id: true } });
    editorId = created.id;
    await audit(ctx, "pubsetup.editor.created", "pubsetup_editor", created.id);
  }
  scheduleRefresh(ctx, await linkedPublicationIds(ctx, editorId), [editorId]);
  redirect(withMessage(`/settings/publication-setup/editors/${editorId}`, "notice", `${data.name} saved.`));
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
  scheduleRefresh(ctx, await linkedPublicationIds(ctx, editor.id), [editor.id]);
  redirect(withMessage(archive ? "/settings/publication-setup/editors?show=archived" : `/settings/publication-setup/editors/${editor.id}`, "notice", `${editor.name} ${archive ? "archived" : "restored"}.`));
}

// ── Who writes what ────────────────────────────────────────────────────────

function roleOf(formData: FormData): string {
  const role = String(formData.get("role") ?? "lead");
  return (EDITOR_ROLES as readonly string[]).includes(role) ? role : "lead";
}

export async function linkEditor(formData: FormData) {
  const publicationId = idOf(formData, "publicationId");
  const editorId = idOf(formData, "editorId");
  const back = String(formData.get("back") ?? "") === "editor" ? `/settings/publication-setup/editors/${editorId}` : `/settings/publication-setup/publications/${publicationId}`;
  const ctx = await pubsetupAction(back);
  const db = tenantDb(ctx.resolved.id);
  const [pub, editor] = await Promise.all([
    publicationId ? db.calendarPublication.findFirst({ where: { id: publicationId, brandId: ctx.brand.id }, select: { id: true } }) : null,
    editorId ? db.pubEditor.findFirst({ where: { id: editorId, brandId: ctx.brand.id }, select: { id: true, name: true } }) : null,
  ]);
  if (!pub || !editor) redirect(withMessage(back, "error", "Pick a publication and an editor."));
  const role = roleOf(formData);
  const link = await db.pubPublicationEditor.findFirst({ where: { publicationId: pub.id, editorId: editor.id }, select: { id: true } });
  if (link) await db.pubPublicationEditor.updateMany({ where: { id: link.id }, data: { role } });
  else {
    const count = await db.pubPublicationEditor.count({ where: { publicationId: pub.id } });
    await db.pubPublicationEditor.create({ data: { organizationId: ctx.resolved.id, publicationId: pub.id, editorId: editor.id, role, sortOrder: count } });
  }
  await audit(ctx, "pubsetup.editor.linked", "calendar_publication", pub.id, { editorId: editor.id, role });
  scheduleRefresh(ctx, [pub.id], [editor.id]);
  redirect(withMessage(back, "notice", `${editor.name} saved as ${role === "lead" ? "lead editor" : role}.`));
}

export async function unlinkEditor(formData: FormData) {
  const publicationId = idOf(formData, "publicationId");
  const editorId = idOf(formData, "editorId");
  const back = String(formData.get("back") ?? "") === "editor" ? `/settings/publication-setup/editors/${editorId}` : `/settings/publication-setup/publications/${publicationId}`;
  const ctx = await pubsetupAction(back);
  const db = tenantDb(ctx.resolved.id);
  const pub = publicationId ? await db.calendarPublication.findFirst({ where: { id: publicationId, brandId: ctx.brand.id }, select: { id: true } }) : null;
  if (!pub || !editorId) redirect(withMessage(back, "error", "That link no longer exists."));
  await db.pubPublicationEditor.deleteMany({ where: { publicationId: pub.id, editorId } });
  await audit(ctx, "pubsetup.editor.unlinked", "calendar_publication", pub.id, { editorId });
  scheduleRefresh(ctx, [pub.id], [editorId]);
  redirect(withMessage(back, "notice", "Removed."));
}
