import { appendOrgAudit, tenantDb, type Prisma } from "@pubcommand/db";
import { after } from "next/server";
import { EDITOR_FIELDS, EDITOR_ROLES, PUBLICATION_FIELDS, firstError, parseFields, uniqueSlug, type FieldDef, type FieldValues, type FormLike } from "../../../../../modules/pubsetup/fields";
import { notifyBrandSites } from "../websites/api";
import { refreshEditor, refreshPublication } from "./teach";

/**
 * Saving publications and editors (gurus): the rules Settings → Publication Setup and AI agents
 * share. Validation is parseFields() over form-shaped values, so both go through the same checks.
 * Images (logos, covers, photos) are uploads and are only set from the settings pages.
 */

export type PubsetupScope = { organizationId: string; brandId: string; actorId: string };
export type SaveResult = { ok: true; id: string; name: string; created: boolean } | { ok: false; error: string };

type ImageColumns = Record<string, string | boolean | Uint8Array | null>;
type RecordForm = FormLike & { get(name: string): unknown };

function str(values: FieldValues, key: string): string | null {
  const value = values[key];
  return typeof value === "string" && value ? value : null;
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? [])) as Prisma.InputJsonValue;
}

function audit(scope: PubsetupScope, action: string, targetType: string, targetId: string, metadata?: Prisma.InputJsonValue) {
  return appendOrgAudit(scope.organizationId, { actorId: scope.actorId, action, targetType, targetId, ...(metadata ? { metadata } : {}) });
}

/** After the response: re-teach the Brain and refresh the brand's separately hosted websites. */
export function scheduleRefresh(scope: PubsetupScope, publicationIds: string[], editorIds: string[]) {
  after(async () => {
    for (const publicationId of publicationIds) await refreshPublication({ ...scope, publicationId });
    for (const editorId of editorIds) await refreshEditor({ ...scope, editorId });
    await notifyBrandSites(scope.organizationId, scope.brandId);
  });
}

export async function linkedEditorIds(organizationId: string, publicationId: string): Promise<string[]> {
  return (await tenantDb(organizationId).pubPublicationEditor.findMany({ where: { publicationId }, select: { editorId: true } })).map((l) => l.editorId);
}

export async function linkedPublicationIds(organizationId: string, editorId: string): Promise<string[]> {
  return (await tenantDb(organizationId).pubPublicationEditor.findMany({ where: { editorId }, select: { publicationId: true } })).map((l) => l.publicationId);
}

// ── Form-shaped values (for agents) ─────────────────────────────────────────

/** One field's stored value as the text a form would send. */
function asFormText(def: FieldDef, value: unknown): string | Record<string, string>[] {
  if (value === null || value === undefined) return "";
  if (def.kind === "pairs") return Array.isArray(value) ? (value as Record<string, string>[]) : [];
  if (def.kind === "list") return Array.isArray(value) ? (value as string[]).join("\n") : String(value);
  if (def.kind === "date") return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  return String(value);
}

/**
 * Builds form values from a stored row (for an update, so fields not sent keep their value) and
 * the fields an agent sent. Lists take an array of strings; pair rows an array of objects.
 */
export function formFrom(defs: readonly FieldDef[], stored: Record<string, unknown> | null, sent: Record<string, unknown>): FormData {
  const form = new FormData();
  for (const def of defs) {
    const has = Object.prototype.hasOwnProperty.call(sent, def.key);
    const value = has ? sent[def.key] : stored?.[def.key];
    const text = asFormText(def, value);
    if (Array.isArray(text)) {
      text.slice(0, def.maxRows ?? 6).forEach((row, i) => {
        for (const column of def.columns ?? []) form.set(`${def.key}.${i}.${column.key}`, String(row?.[column.key] ?? ""));
      });
    } else if (text !== "") form.set(def.key, text);
  }
  return form;
}

// ── Publications ────────────────────────────────────────────────────────────

export async function savePublicationRecord(scope: PubsetupScope, formData: RecordForm, id: string | null, images: ImageColumns = {}): Promise<SaveResult> {
  const db = tenantDb(scope.organizationId);
  const parsed = parseFields(PUBLICATION_FIELDS, formData);
  if (!parsed.ok) return { ok: false, error: firstError(PUBLICATION_FIELDS, parsed.errors) };
  const v = parsed.values;
  const code = str(v, "code")!;
  const existing = id ? await db.calendarPublication.findFirst({ where: { id, brandId: scope.brandId } }) : null;
  if (id && !existing) return { ok: false, error: "That publication no longer exists." };

  const codeClash = await db.calendarPublication.findFirst({ where: { brandId: scope.brandId, code, ...(id ? { id: { not: id } } : {}) }, select: { name: true, deletedAt: true } });
  if (codeClash) return { ok: false, error: `Code ${code} is already used by ${codeClash.name}${codeClash.deletedAt ? " (archived: restore it instead)" : ""}.` };

  const typedSlug = String(formData.get("slug") ?? "").trim() !== "" && String(formData.get("slug")) !== existing?.slug;
  let slug = str(v, "slug") ?? "publication";
  const others = await db.calendarPublication.findMany({ where: { brandId: scope.brandId, ...(id ? { id: { not: id } } : {}) }, select: { slug: true } });
  const taken = others.map((o) => o.slug).filter((s): s is string => Boolean(s));
  if (taken.includes(slug)) {
    if (typedSlug) return { ok: false, error: `URL name "${slug}" is already used by another publication.` };
    slug = uniqueSlug(slug, taken);
  }

  // A category must be one of this brand's.
  const categoryId = str(v, "categoryId");
  if (categoryId && !(await db.pubCategory.findFirst({ where: { id: categoryId, brandId: scope.brandId }, select: { id: true } }))) {
    return { ok: false, error: "That category no longer exists. Pick another." };
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
    updatedById: scope.actorId,
  };

  let publicationId: string;
  if (existing) {
    await db.calendarPublication.updateMany({ where: { id: existing.id }, data: { ...data, ...images } });
    if (existing.code !== code) {
      // Issues point at a publication by code: keep them attached when the code changes.
      await db.calendarIssue.updateMany({ where: { brandId: scope.brandId, publicationCode: existing.code }, data: { publicationCode: code } });
    }
    await audit(scope, "pubsetup.publication.updated", "calendar_publication", existing.id, existing.code !== code ? { from: existing.code, to: code } : undefined);
    publicationId = existing.id;
  } else {
    const created = await db.calendarPublication.create({ data: { organizationId: scope.organizationId, brandId: scope.brandId, ...data, ...images, createdById: scope.actorId }, select: { id: true } });
    publicationId = created.id;
    await audit(scope, "pubsetup.publication.created", "calendar_publication", created.id, { code });
  }
  scheduleRefresh(scope, [publicationId], await linkedEditorIds(scope.organizationId, publicationId));
  return { ok: true, id: publicationId, name: data.name, created: !existing };
}

// ── Editors (gurus) ─────────────────────────────────────────────────────────

export async function saveEditorRecord(scope: PubsetupScope, formData: RecordForm, id: string | null, images: ImageColumns = {}): Promise<SaveResult> {
  const db = tenantDb(scope.organizationId);
  const parsed = parseFields(EDITOR_FIELDS, formData);
  if (!parsed.ok) return { ok: false, error: firstError(EDITOR_FIELDS, parsed.errors) };
  const v = parsed.values;
  const existing = id ? await db.pubEditor.findFirst({ where: { id, brandId: scope.brandId }, select: { id: true, slug: true } }) : null;
  if (id && !existing) return { ok: false, error: "That editor no longer exists." };

  const typedSlug = String(formData.get("slug") ?? "").trim() !== "" && String(formData.get("slug")) !== existing?.slug;
  let slug = str(v, "slug") ?? "editor";
  const others = await db.pubEditor.findMany({ where: { brandId: scope.brandId, ...(id ? { id: { not: id } } : {}) }, select: { slug: true } });
  const taken = others.map((o) => o.slug);
  if (taken.includes(slug)) {
    if (typedSlug) return { ok: false, error: `URL name "${slug}" is already used by another editor.` };
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
    updatedById: scope.actorId,
    ...images,
  };
  let editorId: string;
  if (existing) {
    await db.pubEditor.updateMany({ where: { id: existing.id }, data });
    await audit(scope, "pubsetup.editor.updated", "pubsetup_editor", existing.id);
    editorId = existing.id;
  } else {
    const created = await db.pubEditor.create({ data: { organizationId: scope.organizationId, brandId: scope.brandId, ...data, createdById: scope.actorId }, select: { id: true } });
    editorId = created.id;
    await audit(scope, "pubsetup.editor.created", "pubsetup_editor", created.id);
  }
  scheduleRefresh(scope, await linkedPublicationIds(scope.organizationId, editorId), [editorId]);
  return { ok: true, id: editorId, name: data.name, created: !existing };
}

// ── Who writes what ─────────────────────────────────────────────────────────

export function roleOrLead(value: unknown): string {
  return typeof value === "string" && (EDITOR_ROLES as readonly string[]).includes(value) ? value : "lead";
}

export async function linkEditorRecord(scope: PubsetupScope, publicationId: string, editorId: string, role: string): Promise<{ ok: true; editor: string; role: string } | { ok: false; error: string }> {
  const db = tenantDb(scope.organizationId);
  const [pub, editor] = await Promise.all([
    db.calendarPublication.findFirst({ where: { id: publicationId, brandId: scope.brandId }, select: { id: true } }),
    db.pubEditor.findFirst({ where: { id: editorId, brandId: scope.brandId }, select: { id: true, name: true } }),
  ]);
  if (!pub || !editor) return { ok: false, error: "Pick a publication and an editor of this brand." };
  const link = await db.pubPublicationEditor.findFirst({ where: { publicationId: pub.id, editorId: editor.id }, select: { id: true } });
  if (link) await db.pubPublicationEditor.updateMany({ where: { id: link.id }, data: { role } });
  else {
    const count = await db.pubPublicationEditor.count({ where: { publicationId: pub.id } });
    await db.pubPublicationEditor.create({ data: { organizationId: scope.organizationId, publicationId: pub.id, editorId: editor.id, role, sortOrder: count } });
  }
  await audit(scope, "pubsetup.editor.linked", "calendar_publication", pub.id, { editorId: editor.id, role });
  scheduleRefresh(scope, [pub.id], [editor.id]);
  return { ok: true, editor: editor.name, role };
}

export async function unlinkEditorRecord(scope: PubsetupScope, publicationId: string, editorId: string): Promise<boolean> {
  const db = tenantDb(scope.organizationId);
  const pub = await db.calendarPublication.findFirst({ where: { id: publicationId, brandId: scope.brandId }, select: { id: true } });
  if (!pub) return false;
  await db.pubPublicationEditor.deleteMany({ where: { publicationId: pub.id, editorId } });
  await audit(scope, "pubsetup.editor.unlinked", "calendar_publication", pub.id, { editorId });
  scheduleRefresh(scope, [pub.id], [editorId]);
  return true;
}
