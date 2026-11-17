"use server";

import { appendOrgAudit, tenantDb, type Prisma } from "@pubcommand/db";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { EDITOR_FIELDS, PUBLICATION_FIELDS, uniqueSlug, type FieldValues } from "../../../../../modules/pubsetup/fields";
import { parseImport, planImport, type ImportPlan, type ParsedImport } from "../../../../../modules/pubsetup/import";
import { pubsetupAction, withMessage, type PubsetupCtx } from "./guard";
import { refreshEditor, refreshPublication } from "./teach";

const BACK = "/publication-setup/import";
const MAX_FILE_BYTES = 40 * 1024 * 1024;

export type ImportSummaryRow = { kind: "publication" | "editor"; name: string; code: string | null; action: "create" | "fill" | "same"; detail: string };

export type ImportPreview =
  | null
  | { ok: false; error: string }
  | { ok: true; text: string; rows: ImportSummaryRow[]; links: { code: string; editor: string; role: string; action: "create" | "same" }[]; brandLogo: boolean; counts: ImportPlan["counts"]; warnings: string[] };

async function readText(formData: FormData): Promise<string | { error: string }> {
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_FILE_BYTES) return { error: "Import files must be under 40 MB." };
    return await file.text();
  }
  const text = String(formData.get("text") ?? "");
  return text.trim() ? text : { error: "Choose an import file." };
}

async function currentPlan(ctx: PubsetupCtx, file: ParsedImport): Promise<ImportPlan> {
  const db = tenantDb(ctx.resolved.id);
  const pubSelect = Object.fromEntries([...PUBLICATION_FIELDS.map((d) => [d.key, true]), ["id", true], ["logoFilename", true]]) as Prisma.CalendarPublicationSelect;
  const editorSelect = Object.fromEntries([...EDITOR_FIELDS.map((d) => [d.key, true]), ["id", true], ["photoFilename", true]]) as Prisma.PubEditorSelect;
  const [pubs, editors, links, branding] = await Promise.all([
    db.calendarPublication.findMany({ where: { brandId: ctx.brand.id }, select: pubSelect }),
    db.pubEditor.findMany({ where: { brandId: ctx.brand.id }, select: editorSelect }),
    db.pubPublicationEditor.findMany({ where: { publication: { brandId: ctx.brand.id } }, select: { publication: { select: { code: true } }, editor: { select: { slug: true } } } }),
    db.pubBrandBranding.findFirst({ where: { brandId: ctx.brand.id }, select: { logoFilename: true } }),
  ]);
  type Row = Record<string, unknown>;
  return planImport(file, {
    publications: (pubs as Row[]).map((p) => ({ ...p, id: String(p.id), code: String(p.code), slug: (p.slug as string | null) ?? null, hasLogo: Boolean(p.logoFilename) })),
    editors: (editors as Row[]).map((e) => ({ ...e, id: String(e.id), slug: String(e.slug), name: String(e.name), hasPhoto: Boolean(e.photoFilename) })),
    links: (links as unknown as { publication: { code: string }; editor: { slug: string } }[]).map((l) => ({ code: l.publication.code, editorSlug: l.editor.slug })),
    brandHasLogo: Boolean(branding?.logoFilename),
  });
}

export async function previewImport(_prev: ImportPreview, formData: FormData): Promise<ImportPreview> {
  const ctx = await pubsetupAction(BACK);
  const text = await readText(formData);
  if (typeof text !== "string") return { ok: false, error: text.error };
  const parsed = parseImport(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const plan = await currentPlan(ctx, parsed.file);
  const editorNames = new Map(parsed.file.editors.map((e) => [String(e.values.slug), String(e.values.name)]));
  const rows: ImportSummaryRow[] = [
    ...plan.publications.map((s) => ({ kind: "publication" as const, name: String(s.record.values.name), code: String(s.record.values.code), action: s.action, detail: s.label })),
    ...plan.editors.map((s) => ({ kind: "editor" as const, name: String(s.record.values.name), code: null, action: s.action, detail: s.label })),
  ];
  return {
    ok: true,
    text,
    rows,
    links: plan.links.map((l) => ({ code: l.code, editor: editorNames.get(l.editorSlug) ?? l.editorSlug, role: l.role, action: l.action })),
    brandLogo: plan.brandLogo,
    counts: plan.counts,
    warnings: parsed.file.warnings,
  };
}

function str(values: FieldValues, key: string): string | null {
  const value = values[key];
  return typeof value === "string" && value ? value : null;
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? [])) as Prisma.InputJsonValue;
}

/** Field values as columns. Only keys present in `values` are returned, so a fill touches nothing else. */
function columns(values: FieldValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (key === "launchDate") out[key] = typeof value === "string" && value ? new Date(`${value}T00:00:00Z`) : null;
    else if (key === "offers" || key === "sampleIssues" || key === "socialLinks") out[key] = json(value);
    else out[key] = value;
  }
  return out;
}

export async function commitImport(formData: FormData) {
  const ctx = await pubsetupAction(BACK);
  const db = tenantDb(ctx.resolved.id);
  const text = await readText(formData);
  if (typeof text !== "string") redirect(withMessage(BACK, "error", text.error));
  const parsed = parseImport(text);
  if (!parsed.ok) redirect(withMessage(BACK, "error", parsed.error));
  const plan = await currentPlan(ctx, parsed.file);
  const base = { organizationId: ctx.resolved.id, brandId: ctx.brand.id };
  const touchedEditors = new Set<string>();
  const touchedPubs = new Set<string>();

  // Editors first, so links can point at them.
  const editorIdBySlug = new Map<string, string>();
  const takenEditorSlugs = new Set((await db.pubEditor.findMany({ where: { brandId: ctx.brand.id }, select: { slug: true } })).map((e) => e.slug));
  for (const step of plan.editors) {
    const { values, photo } = step.record;
    const fileSlug = String(values.slug);
    const photoCols = photo ? { photoFilename: photo.filename, photoMime: photo.mime, photoData: photo.data } : {};
    if (step.action === "create") {
      const slug = uniqueSlug(fileSlug, takenEditorSlugs);
      takenEditorSlugs.add(slug);
      const { slug: _ignored, ...rest } = values;
      const created = await db.pubEditor.create({
        data: { ...base, ...(columns(rest) as object), name: String(values.name), slug, ...photoCols, createdById: ctx.actorId, updatedById: ctx.actorId } as Prisma.PubEditorUncheckedCreateInput,
        select: { id: true },
      });
      editorIdBySlug.set(fileSlug, created.id);
      touchedEditors.add(created.id);
    } else {
      editorIdBySlug.set(fileSlug, step.existingId!);
      if (step.action === "fill") {
        await db.pubEditor.updateMany({ where: { id: step.existingId! }, data: { ...columns(step.fill), ...(step.image ? photoCols : {}), updatedById: ctx.actorId } });
        touchedEditors.add(step.existingId!);
      }
    }
  }

  const pubIdByCode = new Map<string, string>();
  const takenPubSlugs = new Set((await db.calendarPublication.findMany({ where: { brandId: ctx.brand.id }, select: { slug: true } })).map((p) => p.slug).filter((s): s is string => Boolean(s)));
  for (const step of plan.publications) {
    const { values, logo } = step.record;
    const code = String(values.code);
    const logoCols = logo ? { logoFilename: logo.filename, logoMime: logo.mime, logoData: logo.data } : {};
    if (step.action === "create") {
      const slug = uniqueSlug(str(values, "slug") ?? code.toLowerCase(), takenPubSlugs);
      takenPubSlugs.add(slug);
      const { slug: _ignored, ...rest } = values;
      const status = str(values, "status") ?? "active";
      const created = await db.calendarPublication.create({
        data: {
          ...base,
          ...(columns(rest) as object),
          code,
          name: String(values.name),
          color: String(values.color),
          slug,
          status,
          active: status !== "retired",
          ...logoCols,
          createdById: ctx.actorId,
          updatedById: ctx.actorId,
        } as Prisma.CalendarPublicationUncheckedCreateInput,
        select: { id: true },
      });
      pubIdByCode.set(code, created.id);
      touchedPubs.add(created.id);
    } else {
      pubIdByCode.set(code, step.existingId!);
      if (step.action === "fill") {
        await db.calendarPublication.updateMany({ where: { id: step.existingId! }, data: { ...columns(step.fill), ...(step.image ? logoCols : {}), updatedById: ctx.actorId } });
        touchedPubs.add(step.existingId!);
      }
    }
  }

  let linked = 0;
  for (const link of plan.links) {
    if (link.action !== "create") continue;
    const publicationId = pubIdByCode.get(link.code);
    const editorId = editorIdBySlug.get(link.editorSlug);
    if (!publicationId || !editorId) continue;
    const have = await db.pubPublicationEditor.findFirst({ where: { publicationId, editorId }, select: { id: true } });
    if (have) continue;
    const count = await db.pubPublicationEditor.count({ where: { publicationId } });
    await db.pubPublicationEditor.create({ data: { organizationId: ctx.resolved.id, publicationId, editorId, role: link.role, sortOrder: count } });
    touchedPubs.add(publicationId);
    touchedEditors.add(editorId);
    linked += 1;
  }

  if (plan.brandLogo && parsed.file.brandLogo) {
    const logo = parsed.file.brandLogo;
    const cols = { logoFilename: logo.filename, logoMime: logo.mime, logoData: logo.data, updatedById: ctx.actorId };
    const row = await db.pubBrandBranding.findFirst({ where: { brandId: ctx.brand.id }, select: { id: true } });
    if (row) await db.pubBrandBranding.updateMany({ where: { id: row.id }, data: cols });
    else await db.pubBrandBranding.create({ data: { ...base, ...cols } });
  }

  await appendOrgAudit(ctx.resolved.id, {
    actorId: ctx.actorId,
    action: "pubsetup.imported",
    targetType: "brand",
    targetId: ctx.brand.id,
    metadata: { created: plan.counts.create, filled: plan.counts.fill, links: linked, brandLogo: plan.brandLogo },
  });

  // Each saved publication and editor teaches the Brain, exactly as a form save does.
  const refresh = { ...base, actorId: ctx.actorId };
  after(async () => {
    for (const publicationId of touchedPubs) await refreshPublication({ ...refresh, publicationId });
    for (const editorId of touchedEditors) await refreshEditor({ ...refresh, editorId });
  });

  const parts = [`${plan.counts.create} added`, `${plan.counts.fill} filled in`, `${linked} editor link${linked === 1 ? "" : "s"}`];
  redirect(withMessage("/publication-setup", "notice", `Import done: ${parts.join(", ")}.`));
}
