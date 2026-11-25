import { appendOrgAudit, rawPrisma, tenantDb } from "@pubcommand/db";
import { canManagePublications } from "../../../../../modules/pubsetup/access";
import { EDITOR_FIELDS, EDITOR_ROLES, PUBLICATION_FIELDS, type FieldDef } from "../../../../../modules/pubsetup/fields";
import { CONSOLE_ORG_SLUG } from "@/lib/console-workspace";
import { formFrom, linkEditorRecord, linkedEditorIds, roleOrLead, saveEditorRecord, savePublicationRecord, scheduleRefresh, unlinkEditorRecord, type PubsetupScope } from "../pubsetup/records";
import { pickBrand, scopeFor, type AgentContext } from "./context";
import { ToolError, UUID, str, type Tool } from "./tool-kit";

/**
 * Publications and gurus (editors / experts) in Publication Setup, for AI agents.
 * Organization agents: in their organization, with Publication Setup admin rights
 * (pubsetup.manage), like a person. Platform agents: in any organization (organization
 * argument); changes need "Can make admin changes". Saves go through the same rules as
 * Settings → Publication Setup (features/pubsetup/records.ts); images are set on those pages.
 */

type Target = { scope: PubsetupScope; organizationName: string; brandName: string };

async function target(ctx: AgentContext, args: Record<string, unknown>, write: boolean): Promise<Target> {
  if (ctx.scope === "platform") {
    if (write && !ctx.allowAdminActions) throw new ToolError("This platform agent cannot make admin changes (read-only). A super admin can turn on \"Can make admin changes\" in the console.");
    const wanted = (str(args, "organization", 100) ?? "").trim().toLowerCase();
    if (!wanted) throw new ToolError("organization is required (slug or id).");
    const org = await rawPrisma().organization.findFirst({ where: { deletedAt: null, NOT: { slug: CONSOLE_ORG_SLUG }, OR: [{ slug: wanted }, ...(UUID.test(wanted) ? [{ id: wanted }] : [])] }, select: { id: true, name: true } });
    if (!org) throw new ToolError(`No organization "${wanted}". Call list_organizations.`);
    const brands = await tenantDb(org.id).brand.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, slug: true } });
    const b = str(args, "brand", 100)?.trim().toLowerCase();
    const brand = b ? brands.find((x) => x.id === b || x.slug === b || x.name.toLowerCase() === b) : brands[0];
    if (!brand) throw new ToolError(b ? `No brand "${b}" in ${org.name}. Brands: ${brands.map((x) => x.name).join(", ")}.` : `${org.name} has no brands.`);
    return { scope: { organizationId: org.id, brandId: brand.id, actorId: ctx.agent.userId }, organizationName: org.name, brandName: brand.name };
  }
  if (args.organization) throw new ToolError("organization is only for platform agents. You work in your own organization.");
  const brand = pickBrand(ctx, args.brand);
  if (!brand) throw new ToolError(args.brand ? "No brand by that name you can work in. Call list_brands." : "This organization has no brands yet.");
  if (!canManagePublications(ctx.subject, scopeFor(ctx, brand.id))) throw new ToolError("You do not have permission for Publication Setup (pubsetup.manage, an admin right). Ask an admin to change your access in AI Agents.");
  return { scope: { organizationId: ctx.organization.id, brandId: brand.id, actorId: ctx.agent.userId }, organizationName: ctx.organization.name, brandName: brand.name };
}

const available = (ctx: AgentContext) =>
  ctx.scope === "platform" || (ctx.subject.entitledModuleIds.includes("pubsetup") && ctx.brands.some((brand) => canManagePublications(ctx.subject, scopeFor(ctx, brand.id))));

const where = {
  organization: { type: "string", description: "Platform agents only: the organization (slug or id)." },
  brand: { type: "string", description: "Brand id, slug or name (default: the first brand)." },
};

function fieldsJson(defs: readonly FieldDef[]) {
  return defs.map((def) => ({
    key: def.key,
    label: def.label,
    kind: def.kind,
    ...(def.required ? { required: true } : {}),
    ...(def.options ? { options: def.options } : {}),
    ...(def.columns ? { rows_of: def.columns.map((c) => c.key), max_rows: def.maxRows ?? 6 } : {}),
    ...(def.hint ? { hint: def.hint } : {}),
  }));
}

function values(defs: readonly FieldDef[], row: Record<string, unknown>) {
  return Object.fromEntries(defs.map((def) => [def.key, row[def.key] instanceof Date ? (row[def.key] as Date).toISOString().slice(0, 10) : (row[def.key] ?? null)]));
}

function sentFields(args: Record<string, unknown>, defs: readonly FieldDef[]): Record<string, unknown> {
  const fields = args.fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new ToolError("fields must be an object of field keys and values (see publication_fields).");
  const known = new Set(defs.map((d) => d.key));
  const unknown = Object.keys(fields).filter((key) => !known.has(key));
  if (unknown.length) throw new ToolError(`Unknown fields: ${unknown.join(", ")}. Call publication_fields.`);
  return fields as Record<string, unknown>;
}

async function findPublication(t: Target, value: unknown) {
  const wanted = typeof value === "string" ? value.trim() : "";
  if (!wanted) throw new ToolError("publication is required (id, code, URL name or name).");
  const rows = await tenantDb(t.scope.organizationId).calendarPublication.findMany({ where: { brandId: t.scope.brandId } });
  const lower = wanted.toLowerCase();
  const pub = rows.find((p) => p.id === lower || p.code.toLowerCase() === lower || p.slug?.toLowerCase() === lower || p.name.toLowerCase() === lower);
  if (!pub) throw new ToolError(`No publication "${wanted}" in ${t.brandName}. Call list_publications.`);
  return pub;
}

async function findGuru(t: Target, value: unknown) {
  const wanted = typeof value === "string" ? value.trim() : "";
  if (!wanted) throw new ToolError("guru is required (id, URL name or name).");
  const rows = await tenantDb(t.scope.organizationId).pubEditor.findMany({ where: { brandId: t.scope.brandId } });
  const lower = wanted.toLowerCase();
  const guru = rows.find((g) => g.id === lower || g.slug.toLowerCase() === lower || g.name.toLowerCase() === lower);
  if (!guru) throw new ToolError(`No guru "${wanted}" in ${t.brandName}. Call list_gurus.`);
  return guru;
}

const fieldsArg = { fields: { type: "object", description: "Field keys and values (see publication_fields). Lists take an array of strings; rows (offers, FAQ, links…) an array of objects." } };

export const PUBLICATION_TOOLS: Tool[] = [
  {
    name: "publication_fields",
    title: "Publication and guru fields",
    description: "The fields of a publication and of a guru (editor / expert) in Publication Setup: keys, kinds, required ones, choices, and row columns. Use these keys in create_/update_ publication and guru.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    readOnly: true,
    available,
    run: async () => ({ data: { publication: fieldsJson(PUBLICATION_FIELDS), guru: fieldsJson(EDITOR_FIELDS), guru_roles: EDITOR_ROLES } }),
  },
  {
    name: "list_publications",
    title: "List publications",
    description: "A brand's publications (newsletters, services) in Publication Setup, with their gurus.",
    inputSchema: { type: "object", properties: { ...where, include_archived: { type: "boolean" } }, additionalProperties: false },
    readOnly: true,
    available,
    run: async (ctx, args) => {
      const t = await target(ctx, args, false);
      const db = tenantDb(t.scope.organizationId);
      const pubs = await db.calendarPublication.findMany({ where: { brandId: t.scope.brandId, ...(args.include_archived === true ? {} : { deletedAt: null }) }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
      const links = await db.pubPublicationEditor.findMany({ where: { publicationId: { in: pubs.map((p) => p.id) } }, include: { editor: { select: { name: true } } } });
      return {
        data: {
          brand: `${t.organizationName} · ${t.brandName}`,
          publications: pubs.map((p) => ({
            id: p.id,
            code: p.code,
            name: p.name,
            url_name: p.slug,
            status: p.status,
            tier: p.tier,
            frequency: p.frequency,
            archived: Boolean(p.deletedAt),
            gurus: links.filter((l) => l.publicationId === p.id).map((l) => `${l.editor.name} (${l.role})`),
          })),
        },
      };
    },
  },
  {
    name: "get_publication",
    title: "Get a publication",
    description: "One publication with every field and its gurus.",
    inputSchema: { type: "object", properties: { ...where, publication: { type: "string", description: "Id, code, URL name or name." } }, required: ["publication"], additionalProperties: false },
    readOnly: true,
    available,
    run: async (ctx, args) => {
      const t = await target(ctx, args, false);
      const pub = await findPublication(t, args.publication);
      const links = await tenantDb(t.scope.organizationId).pubPublicationEditor.findMany({ where: { publicationId: pub.id }, include: { editor: { select: { id: true, name: true } } }, orderBy: { sortOrder: "asc" } });
      return { data: { id: pub.id, archived: Boolean(pub.deletedAt), fields: values(PUBLICATION_FIELDS, pub as unknown as Record<string, unknown>), gurus: links.map((l) => ({ id: l.editor.id, name: l.editor.name, role: l.role })) }, targetType: "calendar_publication", targetId: pub.id };
    },
  },
  {
    name: "create_publication",
    title: "Create a publication",
    description: "Add a publication to a brand. Required: name, code, status (active, launching, paused, retired) and color (#rrggbb). Other fields optional (see publication_fields).",
    inputSchema: { type: "object", properties: { ...where, ...fieldsArg }, required: ["fields"], additionalProperties: false },
    readOnly: false,
    available,
    run: async (ctx, args) => {
      const t = await target(ctx, args, true);
      const sent = sentFields(args, PUBLICATION_FIELDS);
      const result = await savePublicationRecord(t.scope, formFrom(PUBLICATION_FIELDS, { status: "active", color: "#1f2a44" }, sent), null);
      if (!result.ok) throw new ToolError(result.error);
      return { data: { id: result.id, name: result.name, brand: `${t.organizationName} · ${t.brandName}`, message: "Publication created." }, targetType: "calendar_publication", targetId: result.id };
    },
  },
  {
    name: "update_publication",
    title: "Update a publication",
    description: "Change a publication. Send only the fields to change; the rest keep their values.",
    inputSchema: { type: "object", properties: { ...where, publication: { type: "string" }, ...fieldsArg }, required: ["publication", "fields"], additionalProperties: false },
    readOnly: false,
    available,
    run: async (ctx, args) => {
      const t = await target(ctx, args, true);
      const pub = await findPublication(t, args.publication);
      const sent = sentFields(args, PUBLICATION_FIELDS);
      const result = await savePublicationRecord(t.scope, formFrom(PUBLICATION_FIELDS, pub as unknown as Record<string, unknown>, sent), pub.id);
      if (!result.ok) throw new ToolError(result.error);
      return { data: { id: result.id, name: result.name, message: "Publication saved." }, targetType: "calendar_publication", targetId: result.id };
    },
  },
  {
    name: "archive_publication",
    title: "Archive or restore a publication",
    description: "Archive a publication (it leaves every picker; old issues and stats keep it) or restore it.",
    inputSchema: { type: "object", properties: { ...where, publication: { type: "string" }, archived: { type: "boolean" } }, required: ["publication", "archived"], additionalProperties: false },
    readOnly: false,
    available,
    run: async (ctx, args) => {
      const t = await target(ctx, args, true);
      const pub = await findPublication(t, args.publication);
      const archive = args.archived === true;
      await tenantDb(t.scope.organizationId).calendarPublication.updateMany({
        where: { id: pub.id },
        data: archive ? { deletedAt: new Date(), active: false, updatedById: t.scope.actorId } : { deletedAt: null, active: pub.status !== "retired", updatedById: t.scope.actorId },
      });
      await appendOrgAudit(t.scope.organizationId, { actorId: t.scope.actorId, action: archive ? "pubsetup.publication.archived" : "pubsetup.publication.restored", targetType: "calendar_publication", targetId: pub.id });
      scheduleRefresh(t.scope, [pub.id], await linkedEditorIds(t.scope.organizationId, pub.id));
      return { data: { publication: pub.name, archived: archive }, targetType: "calendar_publication", targetId: pub.id };
    },
  },
  {
    name: "list_gurus",
    title: "List gurus",
    description: "A brand's gurus (editors, experts) in Publication Setup, with the publications they write for.",
    inputSchema: { type: "object", properties: { ...where, include_archived: { type: "boolean" } }, additionalProperties: false },
    readOnly: true,
    available,
    run: async (ctx, args) => {
      const t = await target(ctx, args, false);
      const db = tenantDb(t.scope.organizationId);
      const gurus = await db.pubEditor.findMany({ where: { brandId: t.scope.brandId, ...(args.include_archived === true ? {} : { deletedAt: null }) }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
      const links = await db.pubPublicationEditor.findMany({ where: { editorId: { in: gurus.map((g) => g.id) } }, include: { publication: { select: { name: true } } } });
      return {
        data: {
          brand: `${t.organizationName} · ${t.brandName}`,
          gurus: gurus.map((g) => ({ id: g.id, name: g.name, url_name: g.slug, title: g.title, status: g.status, archived: Boolean(g.deletedAt), writes_for: links.filter((l) => l.editorId === g.id).map((l) => `${l.publication.name} (${l.role})`) })),
        },
      };
    },
  },
  {
    name: "get_guru",
    title: "Get a guru",
    description: "One guru (editor / expert) with every field and their publications.",
    inputSchema: { type: "object", properties: { ...where, guru: { type: "string", description: "Id, URL name or name." } }, required: ["guru"], additionalProperties: false },
    readOnly: true,
    available,
    run: async (ctx, args) => {
      const t = await target(ctx, args, false);
      const guru = await findGuru(t, args.guru);
      const links = await tenantDb(t.scope.organizationId).pubPublicationEditor.findMany({ where: { editorId: guru.id }, include: { publication: { select: { id: true, name: true } } } });
      return { data: { id: guru.id, archived: Boolean(guru.deletedAt), fields: values(EDITOR_FIELDS, guru as unknown as Record<string, unknown>), writes_for: links.map((l) => ({ id: l.publication.id, name: l.publication.name, role: l.role })) }, targetType: "pubsetup_editor", targetId: guru.id };
    },
  },
  {
    name: "create_guru",
    title: "Create a guru",
    description: "Add a guru (editor / expert) to a brand. Required: name and status (active or inactive). Then link_guru to put them on publications.",
    inputSchema: { type: "object", properties: { ...where, ...fieldsArg }, required: ["fields"], additionalProperties: false },
    readOnly: false,
    available,
    run: async (ctx, args) => {
      const t = await target(ctx, args, true);
      const sent = sentFields(args, EDITOR_FIELDS);
      const result = await saveEditorRecord(t.scope, formFrom(EDITOR_FIELDS, { status: "active" }, sent), null);
      if (!result.ok) throw new ToolError(result.error);
      return { data: { id: result.id, name: result.name, brand: `${t.organizationName} · ${t.brandName}`, message: "Guru created." }, targetType: "pubsetup_editor", targetId: result.id };
    },
  },
  {
    name: "update_guru",
    title: "Update a guru",
    description: "Change a guru. Send only the fields to change; the rest keep their values.",
    inputSchema: { type: "object", properties: { ...where, guru: { type: "string" }, ...fieldsArg }, required: ["guru", "fields"], additionalProperties: false },
    readOnly: false,
    available,
    run: async (ctx, args) => {
      const t = await target(ctx, args, true);
      const guru = await findGuru(t, args.guru);
      const sent = sentFields(args, EDITOR_FIELDS);
      const result = await saveEditorRecord(t.scope, formFrom(EDITOR_FIELDS, guru as unknown as Record<string, unknown>, sent), guru.id);
      if (!result.ok) throw new ToolError(result.error);
      return { data: { id: result.id, name: result.name, message: "Guru saved." }, targetType: "pubsetup_editor", targetId: result.id };
    },
  },
  {
    name: "link_guru",
    title: "Put a guru on a publication",
    description: "Make a guru write for a publication, with a role (lead, co-editor, contributor, analyst, guest). Linking again changes the role.",
    inputSchema: { type: "object", properties: { ...where, publication: { type: "string" }, guru: { type: "string" }, role: { type: "string", enum: [...EDITOR_ROLES] } }, required: ["publication", "guru"], additionalProperties: false },
    readOnly: false,
    available,
    run: async (ctx, args) => {
      const t = await target(ctx, args, true);
      const [pub, guru] = await Promise.all([findPublication(t, args.publication), findGuru(t, args.guru)]);
      const result = await linkEditorRecord(t.scope, pub.id, guru.id, roleOrLead(args.role));
      if (!result.ok) throw new ToolError(result.error);
      return { data: { publication: pub.name, guru: result.editor, role: result.role }, targetType: "calendar_publication", targetId: pub.id };
    },
  },
  {
    name: "unlink_guru",
    title: "Take a guru off a publication",
    description: "Remove a guru from a publication (the guru and the publication stay).",
    inputSchema: { type: "object", properties: { ...where, publication: { type: "string" }, guru: { type: "string" } }, required: ["publication", "guru"], additionalProperties: false },
    readOnly: false,
    available,
    run: async (ctx, args) => {
      const t = await target(ctx, args, true);
      const [pub, guru] = await Promise.all([findPublication(t, args.publication), findGuru(t, args.guru)]);
      await unlinkEditorRecord(t.scope, pub.id, guru.id);
      return { data: { publication: pub.name, guru: guru.name, removed: true }, targetType: "calendar_publication", targetId: pub.id };
    },
  },
];
