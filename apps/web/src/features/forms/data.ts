import { tenantDb, type Prisma } from "@pubcommand/db";
import type { FormSummaryResult } from "../../../../../modules/forms/summary";
import { resolveTheme, type ThemeInput } from "../../../../../modules/forms/theme";
import type { AnswerMap, FieldDef, FormLayout, PublicForm, ResolvedTheme, ResponseRecord } from "../../../../../modules/forms/types";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A summary run stuck this long (server restarted mid-run) is shown as failed. */
export const STALE_SUMMARY_MS = 10 * 60 * 1000;

type FieldRow = {
  id: string;
  type: string;
  label: string;
  helpText: string;
  placeholder: string;
  required: boolean;
  config: Prisma.JsonValue;
  visibility: Prisma.JsonValue;
  skipLogic: Prisma.JsonValue;
  groupWithNext: boolean;
};

function withRules<T>(value: Prisma.JsonValue): T | null {
  // Empty JSON ({}), not just SQL NULL, means "no rules".
  return value && typeof value === "object" && !Array.isArray(value) && Array.isArray((value as { rules?: unknown }).rules) && (value as { rules: unknown[] }).rules.length
    ? (value as unknown as T)
    : null;
}

export function rowToField(row: FieldRow): FieldDef {
  return {
    id: row.id,
    type: row.type,
    label: row.label,
    helpText: row.helpText,
    placeholder: row.placeholder,
    required: row.required,
    config: (row.config && typeof row.config === "object" ? row.config : {}) as FieldDef["config"],
    visibility: withRules<NonNullable<FieldDef["visibility"]>>(row.visibility),
    skipLogic: withRules<NonNullable<FieldDef["skipLogic"]>>(row.skipLogic),
    groupWithNext: row.groupWithNext,
  };
}

export function asLayout(value: string): FormLayout {
  return value === "single" ? "single" : "paginated";
}

export async function listForms(organizationId: string, brandId: string, folderId: string | null, q: string) {
  const db = tenantDb(organizationId);
  const query = q.trim();
  const forms = await db.form.findMany({
    where: {
      brandId,
      deletedAt: null,
      ...(folderId === "unfiled" ? { folderId: null } : folderId ? { folderId } : {}),
      ...(query ? { OR: [{ title: { contains: query, mode: "insensitive" as const } }, { internalName: { contains: query, mode: "insensitive" as const } }, { slug: { contains: query } }] } : {}),
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, internalName: true, slug: true, status: true, folderId: true, updatedAt: true, closesAt: true },
    take: 500,
  });
  const counts = await Promise.all(
    forms.map((form) => db.formResponse.count({ where: { formId: form.id, status: "COMPLETE", spamReason: null } })),
  );
  return forms.map((form, index) => ({ ...form, responses: counts[index] ?? 0 }));
}

export async function listFolders(organizationId: string, brandId: string) {
  return tenantDb(organizationId).formFolder.findMany({ where: { brandId }, orderBy: [{ position: "asc" }, { name: "asc" }] });
}

export async function listThemes(organizationId: string, brandId: string) {
  return tenantDb(organizationId).formTheme.findMany({ where: { brandId, deletedAt: null }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
}

export type ThemeRow = Awaited<ReturnType<typeof listThemes>>[number];

export function themeInput(theme: ThemeRow | null, logoSrc: string | null): ThemeInput | null {
  if (!theme) return null;
  return {
    logoSrc,
    logoHeight: theme.logoHeight,
    headerSize: theme.headerSize,
    barColor: theme.barColor,
    accentColor: theme.accentColor,
    privacyPolicyUrl: theme.privacyPolicyUrl,
    companyName: theme.companyName,
    footerText: theme.footerText,
  };
}

/** Logo for the admin preview (served by an authenticated route). */
export function adminLogoSrc(theme: ThemeRow | null): string | null {
  if (!theme) return null;
  if (theme.logoFileId) return `/forms/themes/${theme.id}/logo?v=${theme.updatedAt.getTime()}`;
  return theme.logoUrl && /^https?:\/\//i.test(theme.logoUrl) ? theme.logoUrl : null;
}

export async function loadForm(organizationId: string, brandId: string, formId: string) {
  if (!UUID_RE.test(formId)) return null;
  const db = tenantDb(organizationId);
  const form = await db.form.findFirst({ where: { id: formId, brandId, deletedAt: null } });
  if (!form) return null;
  const fields = await db.formField.findMany({ where: { formId }, orderBy: { position: "asc" } });
  return { form, fields: fields.map(rowToField) };
}

export type LoadedForm = NonNullable<Awaited<ReturnType<typeof loadForm>>>;

export function toPublicForm(form: LoadedForm["form"], fields: FieldDef[]): PublicForm {
  return {
    id: form.id,
    slug: form.slug,
    title: form.title,
    description: form.description,
    layout: asLayout(form.layout),
    showProgress: form.showProgress,
    autoAdvance: form.autoAdvance,
    submitLabel: form.submitLabel,
    confirmTitle: form.confirmTitle,
    confirmMessage: form.confirmMessage,
    redirectUrl: form.redirectUrl,
    disclaimer: form.disclaimerOverride,
    fields,
  };
}

export function toResponseRecord(row: {
  id: string;
  status: "PARTIAL" | "COMPLETE";
  answers: Prisma.JsonValue;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  lastPageIndex: number;
  utm: Prisma.JsonValue;
  spamReason: string | null;
}): ResponseRecord {
  return {
    id: row.id,
    status: row.status,
    answers: (row.answers && typeof row.answers === "object" && !Array.isArray(row.answers) ? row.answers : {}) as AnswerMap,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    durationMs: row.durationMs,
    lastPageIndex: row.lastPageIndex,
    utm: (row.utm && typeof row.utm === "object" ? row.utm : null) as Record<string, string> | null,
    spamReason: row.spamReason,
  };
}

const RESPONSE_SELECT = {
  id: true,
  status: true,
  answers: true,
  startedAt: true,
  completedAt: true,
  durationMs: true,
  lastPageIndex: true,
  utm: true,
  spamReason: true,
} as const;

/** Every response for a form (results and exports). Capped to keep a page responsive. */
export async function loadResponses(organizationId: string, formId: string, filter?: { status?: string; from?: Date | null; to?: Date | null }) {
  const where: Prisma.FormResponseWhereInput = { formId };
  if (filter?.status === "complete") Object.assign(where, { status: "COMPLETE", spamReason: null });
  if (filter?.status === "partial") Object.assign(where, { status: "PARTIAL", spamReason: null });
  if (filter?.status === "flagged") Object.assign(where, { spamReason: { not: null } });
  if (filter?.from || filter?.to) where.startedAt = { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lt: filter.to } : {}) };
  const rows = await tenantDb(organizationId).formResponse.findMany({ where, orderBy: { startedAt: "desc" }, select: RESPONSE_SELECT, take: 20000 });
  return rows.map(toResponseRecord);
}

export async function latestSummary(organizationId: string, formId: string) {
  const row = await tenantDb(organizationId).formSummary.findFirst({ where: { formId }, orderBy: { createdAt: "desc" } });
  if (!row) return null;
  const stale = row.status === "RUNNING" && Date.now() - row.updatedAt.getTime() > STALE_SUMMARY_MS;
  return {
    ...row,
    status: stale ? ("FAILED" as const) : row.status,
    error: stale ? "The summary was interrupted (the server restarted). Run it again." : row.error,
    result: row.result as unknown as FormSummaryResult | null,
  };
}

/** Is the Forms app on for this organization (plan module + org toggle)? Used by public pages, which have no signed-in subject. */
export async function formsEnabled(organizationId: string): Promise<boolean> {
  const organization = await tenantDb(organizationId).organization.findUnique({
    where: { id: organizationId },
    include: { plan: { include: { modules: true } }, modules: true },
  });
  if (!organization || organization.suspendedAt) return false;
  const inPlan = organization.plan.modules.some((row) => row.moduleId === "forms");
  const toggle = organization.modules.find((row) => row.moduleId === "forms");
  return inPlan && (!toggle || toggle.enabled);
}

export function previewTheme(theme: ThemeRow | null, brandName: string): ResolvedTheme {
  return resolveTheme(themeInput(theme, adminLogoSrc(theme)), brandName);
}
