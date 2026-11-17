"use server";

import { can } from "@pubcommand/core";
import { appendOrgAudit, tenantDb, type Prisma } from "@pubcommand/db";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/org";
import { currentRequest } from "@/lib/request";
import { sanitizeField } from "../../../../../modules/forms/fields";
import { cleanLogic } from "../../../../../modules/forms/logic";
import { starterFields } from "../../../../../modules/forms/starters";
import { deletionPlan } from "../../../../../modules/forms/summary";
import { isHexColor, isHttpUrl, isValidFormSlug, normalizeFormSlug, publishProblems } from "../../../../../modules/forms/theme";
import type { FieldDef } from "../../../../../modules/forms/types";
import { UUID_RE, asLayout, loadForm } from "./data";
import { runFormSummary } from "./server";

type Permission = "forms.read" | "forms.write" | "forms.export";

async function formsContext(...permissions: Permission[]) {
  const request = await currentRequest();
  if (request.site.kind !== "org") redirect("/");
  const ctx = await getOrgContext(request.site.slug);
  if (ctx.kind !== "ok") redirect("/");
  if (!ctx.subject.entitledModuleIds.includes("forms") || !permissions.every((permission) => can(ctx.subject, permission, ctx.scope))) {
    redirect("/forms?error=You do not have permission.");
  }
  if (!ctx.brand) redirect("/forms?error=Add a brand in Settings first.");
  return { ...ctx, brand: ctx.brand };
}

type Ctx = Awaited<ReturnType<typeof formsContext>>;

function text(formData: FormData, key: string, max = 300): string {
  return String(formData.get(key) ?? "").trim().slice(0, max);
}

function audit(ctx: Ctx, action: string, targetType: string, targetId: string) {
  return appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action, targetType, targetId });
}

async function ownForm(ctx: Ctx, formId: string) {
  if (!UUID_RE.test(formId)) redirect("/forms?error=That form no longer exists.");
  const form = await tenantDb(ctx.resolved.id).form.findFirst({ where: { id: formId, brandId: ctx.brand.id, deletedAt: null } });
  if (!form) redirect("/forms?error=That form no longer exists.");
  return form;
}

async function uniqueSlug(organizationId: string, wanted: string, exceptId?: string): Promise<string> {
  const base = normalizeFormSlug(wanted) || "form";
  const db = tenantDb(organizationId);
  let slug = base;
  for (let n = 2; await db.form.count({ where: { slug, ...(exceptId ? { id: { not: exceptId } } : {}) } }); n += 1) slug = `${base.slice(0, 55)}-${n}`;
  return slug;
}

async function brandTheme(ctx: Ctx, themeId: string | null) {
  if (!themeId || !UUID_RE.test(themeId)) return null;
  return tenantDb(ctx.resolved.id).formTheme.findFirst({ where: { id: themeId, brandId: ctx.brand.id, deletedAt: null } });
}

async function writeFields(organizationId: string, formId: string, fields: FieldDef[]) {
  const db = tenantDb(organizationId);
  const existing = await db.formField.findMany({ where: { formId }, select: { id: true } });
  const keep = new Set(fields.map((field) => field.id));
  const stale = existing.filter((row) => !keep.has(row.id)).map((row) => row.id);
  if (stale.length) await db.formField.deleteMany({ where: { formId, id: { in: stale } } });
  const have = new Set(existing.map((row) => row.id));
  for (const [position, field] of fields.entries()) {
    const data = {
      position,
      type: field.type,
      label: field.label,
      helpText: field.helpText,
      placeholder: field.placeholder,
      required: field.required,
      config: field.config as unknown as Prisma.InputJsonValue,
      // "No rules" is stored as {} and read back as null (rowToField).
      visibility: (field.visibility ?? {}) as unknown as Prisma.InputJsonValue,
      skipLogic: (field.skipLogic ?? {}) as unknown as Prisma.InputJsonValue,
      groupWithNext: field.groupWithNext,
    };
    if (have.has(field.id)) {
      await db.formField.updateMany({ where: { id: field.id, formId }, data });
    } else {
      // A field id is a UUID from the browser; one already used by another form is refused, not taken over.
      const clash = await db.formField.count({ where: { id: field.id } });
      if (clash) continue;
      await db.formField.create({ data: { ...data, id: field.id, organizationId, formId } });
    }
  }
}

export async function createForm(formData: FormData) {
  const ctx = await formsContext("forms.write");
  const db = tenantDb(ctx.resolved.id);
  const title = text(formData, "title", 200) || "Untitled form";
  const folderIdRaw = text(formData, "folderId", 40);
  const folder = UUID_RE.test(folderIdRaw) ? await db.formFolder.findFirst({ where: { id: folderIdRaw, brandId: ctx.brand.id } }) : null;
  const themes = await db.formTheme.findMany({ where: { brandId: ctx.brand.id, deletedAt: null }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }], select: { id: true } });
  const themeId = folder?.defaultThemeId ?? themes[0]?.id ?? null;
  const form = await db.form.create({
    data: {
      organizationId: ctx.resolved.id,
      brandId: ctx.brand.id,
      title,
      slug: await uniqueSlug(ctx.resolved.id, title),
      folderId: folder?.id ?? null,
      themeId,
      createdById: ctx.auth.user.id,
    },
  });
  const fields = cleanLogic(starterFields(text(formData, "starter", 40), () => crypto.randomUUID()));
  await writeFields(ctx.resolved.id, form.id, fields);
  await audit(ctx, "forms.form.created", "form", form.id);
  redirect(`/forms/${form.id}`);
}

export type SaveFormInput = {
  formId: string;
  fields: FieldDef[];
  settings: {
    title: string;
    internalName: string;
    slug: string;
    description: string;
    layout: string;
    showProgress: boolean;
    autoAdvance: boolean;
    submitLabel: string;
    confirmTitle: string;
    confirmMessage: string;
    redirectUrl: string;
    closedMessage: string;
    disclaimerOverride: string;
    themeId: string;
    folderId: string;
    opensAt: string;
    closesAt: string;
    responseLimit: string;
    brainSyncEnabled: boolean;
  };
};

export type SaveFormResult = { ok: true; savedAt: string; warnings: string[]; slug: string } | { ok: false; error: string };

function parseDate(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Save the whole form from the builder. Every field and rule is re-checked here; the browser is not trusted. */
export async function saveForm(input: SaveFormInput): Promise<SaveFormResult> {
  const ctx = await formsContext("forms.write");
  const form = await ownForm(ctx, String(input?.formId ?? ""));
  const raw = Array.isArray(input.fields) ? input.fields.slice(0, 300) : [];
  const seen = new Set<string>();
  const sanitized: FieldDef[] = [];
  for (const field of raw) {
    if (!field || typeof field.id !== "string" || !UUID_RE.test(field.id) || seen.has(field.id)) continue;
    const clean = sanitizeField(field);
    if (!clean) continue;
    seen.add(field.id);
    sanitized.push(clean);
  }
  const fields = cleanLogic(sanitized);
  const s = input.settings ?? ({} as SaveFormInput["settings"]);
  const str = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  const slug = normalizeFormSlug(str(s.slug, 80));
  if (!isValidFormSlug(slug)) return { ok: false, error: "The link name needs letters or numbers." };
  if ((await uniqueSlug(ctx.resolved.id, slug, form.id)) !== slug) return { ok: false, error: `Another form already uses /f/${slug}.` };
  const redirectUrl = str(s.redirectUrl, 500);
  if (redirectUrl && !isHttpUrl(redirectUrl)) return { ok: false, error: "The redirect must be a full web address starting with https://" };
  const theme = await brandTheme(ctx, str(s.themeId, 40) || null);
  const db = tenantDb(ctx.resolved.id);
  const folderId = str(s.folderId, 40);
  const folder = UUID_RE.test(folderId) ? await db.formFolder.findFirst({ where: { id: folderId, brandId: ctx.brand.id } }) : null;
  const limit = Number(str(s.responseLimit, 9));
  const layout = asLayout(str(s.layout, 20));

  await writeFields(ctx.resolved.id, form.id, fields);
  await db.form.updateMany({
    where: { id: form.id },
    data: {
      title: str(s.title, 200) || "Untitled form",
      internalName: str(s.internalName, 200) || null,
      slug,
      description: str(s.description, 3000),
      layout,
      showProgress: s.showProgress !== false,
      autoAdvance: s.autoAdvance !== false,
      submitLabel: str(s.submitLabel, 40) || "Submit",
      confirmTitle: str(s.confirmTitle, 200) || "Thank you!",
      confirmMessage: str(s.confirmMessage, 3000),
      redirectUrl: redirectUrl || null,
      closedMessage: str(s.closedMessage, 1000) || "This form is not taking responses right now.",
      disclaimerOverride: str(s.disclaimerOverride, 1000) || null,
      themeId: theme?.id ?? null,
      folderId: folder?.id ?? null,
      opensAt: parseDate(str(s.opensAt, 40)),
      closesAt: parseDate(str(s.closesAt, 40)),
      responseLimit: Number.isInteger(limit) && limit > 0 ? limit : null,
      brainSyncEnabled: s.brainSyncEnabled !== false,
    },
  });
  await audit(ctx, "forms.form.saved", "form", form.id);
  const warnings = publishProblems({ title: str(s.title, 200), slug, fields, layout, theme });
  return { ok: true, savedAt: new Date().toISOString(), warnings, slug };
}

export async function setFormStatus(formData: FormData) {
  const ctx = await formsContext("forms.write");
  const form = await ownForm(ctx, text(formData, "formId", 40));
  const status = text(formData, "status", 10);
  const back = `/forms/${form.id}${text(formData, "tab", 20) ? `?tab=${text(formData, "tab", 20)}&` : "?"}`;
  if (status === "OPEN") {
    const loaded = await loadForm(ctx.resolved.id, ctx.brand.id, form.id);
    const theme = await brandTheme(ctx, form.themeId);
    const problems = publishProblems({ title: form.title, slug: form.slug, fields: loaded?.fields ?? [], layout: asLayout(form.layout), theme });
    if (problems.length) redirect(`${back}error=${encodeURIComponent(`Not published: ${problems[0]}`)}`);
  }
  if (status !== "OPEN" && status !== "CLOSED" && status !== "DRAFT") redirect(back);
  await tenantDb(ctx.resolved.id).form.updateMany({
    where: { id: form.id },
    data: { status: status as "OPEN" | "CLOSED" | "DRAFT", ...(status === "OPEN" && !form.publishedAt ? { publishedAt: new Date() } : {}) },
  });
  await audit(ctx, `forms.form.${status.toLowerCase()}`, "form", form.id);
  redirect(`${back}notice=${status === "OPEN" ? "Published. The form is live." : status === "CLOSED" ? "Closed. The form no longer takes responses." : "Moved back to draft."}`);
}

export async function deleteForm(formData: FormData) {
  const ctx = await formsContext("forms.write");
  const form = await ownForm(ctx, text(formData, "formId", 40));
  if (text(formData, "confirm", 200) !== form.title) redirect(`/forms/${form.id}?tab=settings&error=Type the form's title to delete it.`);
  // Soft delete: the public link stops working at once; responses stay recoverable by staff.
  await tenantDb(ctx.resolved.id).form.updateMany({ where: { id: form.id }, data: { deletedAt: new Date(), status: "CLOSED", slug: `${form.slug.slice(0, 40)}-deleted-${Date.now().toString(36)}` } });
  await audit(ctx, "forms.form.deleted", "form", form.id);
  redirect("/forms?notice=Form deleted.");
}

export async function duplicateForm(formData: FormData) {
  const ctx = await formsContext("forms.write");
  const form = await ownForm(ctx, text(formData, "formId", 40));
  const loaded = await loadForm(ctx.resolved.id, ctx.brand.id, form.id);
  const idMap = new Map((loaded?.fields ?? []).map((field) => [field.id, crypto.randomUUID()]));
  const remap = (value: string) => idMap.get(value) ?? value;
  const fields = (loaded?.fields ?? []).map((field) => ({
    ...field,
    id: remap(field.id),
    visibility: field.visibility ? { ...field.visibility, rules: field.visibility.rules.map((rule) => ({ ...rule, fieldId: remap(rule.fieldId) })) } : null,
    skipLogic: field.skipLogic ? { rules: field.skipLogic.rules.map((rule) => ({ ...rule, fieldId: remap(rule.fieldId), goTo: remap(rule.goTo) })) } : null,
  }));
  const { id: _id, createdAt: _c, updatedAt: _u, publishedAt: _p, ...rest } = form;
  const copy = await tenantDb(ctx.resolved.id).form.create({
    data: { ...rest, title: `${form.title} (copy)`, slug: await uniqueSlug(ctx.resolved.id, `${form.slug}-copy`), status: "DRAFT", createdById: ctx.auth.user.id },
  });
  await writeFields(ctx.resolved.id, copy.id, fields);
  await audit(ctx, "forms.form.duplicated", "form", copy.id);
  redirect(`/forms/${copy.id}?notice=Copied. This is the new draft.`);
}

// Themes -----------------------------------------------------------------

const LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export async function saveTheme(formData: FormData) {
  const ctx = await formsContext("forms.write");
  const db = tenantDb(ctx.resolved.id);
  const themeId = text(formData, "themeId", 40);
  const existing = UUID_RE.test(themeId) ? await db.formTheme.findFirst({ where: { id: themeId, brandId: ctx.brand.id, deletedAt: null } }) : null;
  const back = (query: string) => `/forms/themes?${existing ? `edit=${existing.id}&` : ""}${query}`;
  const privacyPolicyUrl = text(formData, "privacyPolicyUrl", 500);
  if (!isHttpUrl(privacyPolicyUrl)) redirect(back("error=A privacy-policy URL starting with https:// is required. Every public form links to it."));
  const logoUrl = text(formData, "logoUrl", 500);
  if (logoUrl && !isHttpUrl(logoUrl)) redirect(back("error=The logo URL must start with https://"));
  const color = (key: string, fallback: string) => (isHexColor(text(formData, key, 7)) ? text(formData, key, 7).toLowerCase() : fallback);
  const height = Number(text(formData, "logoHeight", 4));
  const data = {
    name: text(formData, "name", 120) || "Theme",
    privacyPolicyUrl,
    logoUrl: logoUrl || null,
    logoLinkUrl: isHttpUrl(text(formData, "logoLinkUrl", 500)) ? text(formData, "logoLinkUrl", 500) : null,
    logoHeight: Number.isInteger(height) && height >= 16 && height <= 160 ? height : null,
    headerSize: text(formData, "headerSize", 10) === "tall" ? "tall" : "standard",
    barColor: color("barColor", "#0b1220"),
    accentColor: color("accentColor", "#1d4ed8"),
    companyName: text(formData, "companyName", 200),
    footerText: text(formData, "footerText", 500) || null,
    isDefault: formData.get("isDefault") === "on",
  };
  const file = formData.get("logo");
  let logoFileId: string | null | undefined;
  if (file instanceof File && file.size > 0) {
    if (!LOGO_TYPES.has(file.type)) redirect(back("error=Upload the logo as PNG, JPG, WebP or GIF."));
    if (file.size > MAX_LOGO_BYTES) redirect(back("error=Logos must be under 2 MB."));
    const stored = await db.formFile.create({
      data: { organizationId: ctx.resolved.id, kind: "logo", filename: file.name.slice(0, 200), mimeType: file.type, size: file.size, data: new Uint8Array(await file.arrayBuffer()) },
    });
    logoFileId = stored.id;
  }
  if (formData.get("removeLogo") === "on") logoFileId = null;
  if (data.isDefault) await db.formTheme.updateMany({ where: { brandId: ctx.brand.id }, data: { isDefault: false } });
  let id = existing?.id;
  if (existing) {
    if (existing.logoFileId && logoFileId !== undefined) await db.formFile.deleteMany({ where: { id: existing.logoFileId, kind: "logo" } });
    await db.formTheme.updateMany({ where: { id: existing.id }, data: { ...data, ...(logoFileId !== undefined ? { logoFileId } : {}) } });
  } else {
    const created = await db.formTheme.create({ data: { ...data, organizationId: ctx.resolved.id, brandId: ctx.brand.id, logoFileId: logoFileId ?? null } });
    id = created.id;
  }
  await audit(ctx, existing ? "forms.theme.updated" : "forms.theme.created", "form_theme", id!);
  const returnTo = text(formData, "returnTo", 200);
  if (returnTo.startsWith("/forms/") && !returnTo.startsWith("//")) redirect(returnTo);
  redirect(`/forms/themes?edit=${id}&notice=Theme saved.`);
}

export async function deleteTheme(formData: FormData) {
  const ctx = await formsContext("forms.write");
  const db = tenantDb(ctx.resolved.id);
  const themeId = text(formData, "themeId", 40);
  if (!UUID_RE.test(themeId)) redirect("/forms/themes");
  const inUse = await db.form.count({ where: { themeId, deletedAt: null, status: "OPEN" } });
  if (inUse) redirect(`/forms/themes?edit=${themeId}&error=${inUse} live form(s) use this theme. Switch them first.`);
  await db.formTheme.updateMany({ where: { id: themeId, brandId: ctx.brand.id }, data: { deletedAt: new Date(), isDefault: false } });
  await db.form.updateMany({ where: { themeId, brandId: ctx.brand.id }, data: { themeId: null } });
  await audit(ctx, "forms.theme.deleted", "form_theme", themeId);
  redirect("/forms/themes?notice=Theme deleted.");
}

// Folders ----------------------------------------------------------------

export async function createFolder(formData: FormData) {
  const ctx = await formsContext("forms.write");
  const name = text(formData, "name", 80);
  if (!name) redirect("/forms?error=Name the folder.");
  const folder = await tenantDb(ctx.resolved.id).formFolder.create({ data: { organizationId: ctx.resolved.id, brandId: ctx.brand.id, name } });
  await audit(ctx, "forms.folder.created", "form_folder", folder.id);
  redirect(`/forms?folder=${folder.id}`);
}

export async function updateFolder(formData: FormData) {
  const ctx = await formsContext("forms.write");
  const folderId = text(formData, "folderId", 40);
  if (!UUID_RE.test(folderId)) redirect("/forms");
  const theme = await brandTheme(ctx, text(formData, "defaultThemeId", 40) || null);
  await tenantDb(ctx.resolved.id).formFolder.updateMany({
    where: { id: folderId, brandId: ctx.brand.id },
    data: { name: text(formData, "name", 80) || "Folder", defaultThemeId: theme?.id ?? null },
  });
  await audit(ctx, "forms.folder.updated", "form_folder", folderId);
  redirect(`/forms?folder=${folderId}&notice=Folder saved.`);
}

export async function deleteFolder(formData: FormData) {
  const ctx = await formsContext("forms.write");
  const folderId = text(formData, "folderId", 40);
  if (!UUID_RE.test(folderId)) redirect("/forms");
  const db = tenantDb(ctx.resolved.id);
  // Never deletes forms: they move to Unfiled.
  await db.form.updateMany({ where: { folderId, brandId: ctx.brand.id }, data: { folderId: null } });
  await db.formFolder.deleteMany({ where: { id: folderId, brandId: ctx.brand.id } });
  await audit(ctx, "forms.folder.deleted", "form_folder", folderId);
  redirect("/forms?notice=Folder deleted. Its forms are now Unfiled.");
}

// Results ----------------------------------------------------------------

/** The ONLY path that destroys respondent data. Admin tier (forms.export), explicit scope, title echo for "all". */
export async function deleteResponses(formData: FormData) {
  const ctx = await formsContext("forms.read", "forms.export");
  const form = await ownForm(ctx, text(formData, "formId", 40));
  const back = `/forms/${form.id}/results`;
  const plan = deletionPlan({
    scope: text(formData, "scope", 20),
    ids: formData.getAll("responseId").map(String),
    confirm: text(formData, "confirm", 300),
    formTitle: form.title,
  });
  if (!plan.ok) redirect(`${back}?error=${encodeURIComponent(plan.error)}`);
  const where: Prisma.FormResponseWhereInput = { formId: form.id };
  if (plan.scope === "selected") where.id = { in: plan.ids };
  if (plan.scope === "partial") Object.assign(where, { status: "PARTIAL" });
  if (plan.scope === "flagged") where.spamReason = { not: null };
  const db = tenantDb(ctx.resolved.id);
  const result = await db.formResponse.deleteMany({ where });
  // A summary of responses that no longer exist reads as current. Clear it.
  await db.formSummary.deleteMany({ where: { formId: form.id } });
  await audit(ctx, `forms.responses.deleted.${plan.scope}`, "form", form.id);
  redirect(`${back}?notice=${encodeURIComponent(`Deleted ${result.count} response${result.count === 1 ? "" : "s"}. The AI summary was cleared.`)}`);
}

export async function generateSummary(formData: FormData) {
  const ctx = await formsContext("forms.read", "forms.write");
  const form = await ownForm(ctx, text(formData, "formId", 40));
  const db = tenantDb(ctx.resolved.id);
  const running = await db.formSummary.count({ where: { formId: form.id, status: "RUNNING", updatedAt: { gt: new Date(Date.now() - 10 * 60 * 1000) } } });
  if (running) redirect(`/forms/${form.id}/results?notice=A summary is already running.`);
  const summary = await db.formSummary.create({ data: { organizationId: ctx.resolved.id, formId: form.id, createdById: ctx.auth.user.id } });
  await audit(ctx, "forms.summary.requested", "form", form.id);
  const brand = ctx.brand;
  after(() => runFormSummary({ organizationId: ctx.resolved.id, formId: form.id, summaryId: summary.id, brand, actorId: ctx.auth.user.id }));
  redirect(`/forms/${form.id}/results#summary`);
}
