import { isNiche, slugifyName } from "@pubcommand/core";
import { appendOrgAudit, appendPlatformAudit, changeOrganizationSlug, platformTx, rawPrisma, tenantDb, type Prisma } from "@pubcommand/db";
import { learnedKey } from "../../../../../modules/knowledge/main-brain";
import { CONSOLE_ORG_SLUG } from "@/lib/console-workspace";
import { mainBrain } from "../main-brain/db";
import { syncPushDown } from "../main-brain/push";
import type { AgentContext } from "./context";
import { ToolError, UUID, str, type Tool } from "./tool-kit";

/**
 * Platform agents with "Can make admin changes": restructure organizations and their Brains.
 * Rename an organization, add, change or remove (empty) brands, move Brain notes between brands
 * and organizations, move Master Brain notes into a brand, and delete or restore notes.
 *
 * Moving keeps notes flowing up: a moved note's Master Brain copy is re-pointed to its new
 * organization and brand (and re-keyed), so nothing is duplicated and the Master Brain files it
 * under its new home. Deletes are soft (deletedAt) and every batch is audited with its note ids,
 * so it can be restored by the agent (restore_notes) or by staff (admin console → AI Agents).
 */

const admin = (ctx: AgentContext) => ctx.scope === "platform" && ctx.allowAdminActions;
const MAX_NOTES = 1000;

export type NoteKind = "brain" | "master";

function reasonOf(args: Record<string, unknown>): string {
  const reason = str(args, "reason", 500)?.trim();
  if (!reason || reason.length < 5) throw new ToolError("reason is required: say briefly why (it goes in the audit log).");
  return reason;
}

async function org(value: unknown) {
  const wanted = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!wanted) throw new ToolError("organization is required (slug or id).");
  const row = await rawPrisma().organization.findFirst({ where: { deletedAt: null, NOT: { slug: CONSOLE_ORG_SLUG }, OR: [{ slug: wanted }, ...(UUID.test(wanted) ? [{ id: wanted }] : [])] } });
  if (!row) throw new ToolError(`No organization "${wanted}". Call list_organizations.`);
  return row;
}

async function brand(organizationId: string, value: unknown) {
  const wanted = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!wanted) throw new ToolError("brand is required (slug, name or id).");
  const brands = await tenantDb(organizationId).brand.findMany({ select: { id: true, name: true, slug: true, niche: true } });
  const found = brands.find((b) => b.id === wanted || b.slug === wanted || b.name.toLowerCase() === wanted);
  if (!found) throw new ToolError(`No brand "${wanted}" there. Brands: ${brands.map((b) => b.name).join(", ") || "none"}.`);
  return found;
}

function ids(args: Record<string, unknown>, key = "note_ids"): string[] | null {
  const value = args[key];
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !UUID.test(v))) throw new ToolError(`${key} must be a list of note ids.`);
  if (value.length > MAX_NOTES) throw new ToolError(`At most ${MAX_NOTES} notes at a time.`);
  return [...new Set((value as string[]).map((v) => v.toLowerCase()))];
}

const selectionProps = {
  note_ids: { type: "array", items: { type: "string" }, description: "Exact notes. Or use folder / search / source instead." },
  folder: { type: "string", description: "Notes in this folder (and its subfolders)." },
  search: { type: "string", description: "Notes whose title contains these words." },
  source: { type: "string", description: "Notes with this source, e.g. vault-import, promo-analyzer." },
  dry_run: { type: "boolean", description: "Only count and show a sample; change nothing." },
};

/** A Brain note filter from note_ids / folder / search / source (at least one). */
function brainWhere(args: Record<string, unknown>, deleted: boolean): Prisma.KnowledgePageWhereInput {
  const noteIds = ids(args);
  const folder = str(args, "folder", 200)?.trim();
  const search = str(args, "search", 200)?.trim();
  const source = str(args, "source", 80)?.trim();
  if (!noteIds && !folder && !search && !source) throw new ToolError("Choose the notes: note_ids, or a folder, search or source.");
  return {
    deletedAt: deleted ? { not: null } : null,
    ...(noteIds ? { id: { in: noteIds } } : {}),
    ...(folder ? { OR: [{ folder }, { folder: { startsWith: `${folder}/` } }] } : {}),
    ...(search ? { title: { contains: search, mode: "insensitive" as const } } : {}),
    ...(source ? { source } : {}),
  };
}

function masterWhere(args: Record<string, unknown>, deleted: boolean): Prisma.MainBrainNoteWhereInput {
  const noteIds = ids(args);
  const folder = str(args, "folder", 200)?.trim();
  const search = str(args, "search", 200)?.trim();
  const source = str(args, "source", 80)?.trim();
  if (!noteIds && !folder && !search && !source) throw new ToolError("Choose the notes: note_ids, or a folder, search or source.");
  return {
    deletedAt: deleted ? { not: null } : null,
    ...(noteIds ? { id: { in: noteIds } } : {}),
    ...(folder ? { OR: [{ folder }, { folder: { startsWith: `${folder}/` } }] } : {}),
    ...(search ? { title: { contains: search, mode: "insensitive" as const } } : {}),
    ...(source ? { source } : {}),
  };
}

async function uniqueBrainSlug(tx: Prisma.TransactionClient, organizationId: string, title: string): Promise<string> {
  const base = (slugifyName(title) || "note").slice(0, 60);
  let slug = base;
  for (let n = 2; await tx.knowledgePage.count({ where: { organizationId, slug } }); n += 1) slug = `${base}-${n}`;
  return slug;
}

/** Re-point (and re-key) the Master Brain copy of a brand note after it moved. */
async function repointMaster(input: { fromOrganizationId: string; toOrganizationId: string; brandId: string; sourceRef: string; noteId: string }) {
  await mainBrain(async (tx) => {
    const oldKey = learnedKey(input.fromOrganizationId, input.sourceRef);
    const newKey = learnedKey(input.toOrganizationId, input.sourceRef);
    const existing = await tx.mainBrainNote.findUnique({ where: { key: oldKey } });
    if (!existing) return;
    const clash = oldKey !== newKey ? await tx.mainBrainNote.findUnique({ where: { key: newKey }, select: { id: true } }) : null;
    await tx.mainBrainNote.update({
      where: { id: existing.id },
      data: { ...(clash ? {} : { key: newKey }), originOrganizationId: input.toOrganizationId, originBrandId: input.brandId, originNoteId: input.noteId },
    });
  });
}

/** Records a delete batch (agents' restore tool and the admin console's "Notes deleted by AI agents" list read it). */
async function auditNotes(ctx: AgentContext, action: "deleted" | "restored", kind: NoteKind, organizationId: string | null, noteIds: string[], reason: string) {
  await appendPlatformAudit({
    actorId: ctx.agent.userId,
    action: `agents.notes.${action}`,
    targetType: kind === "master" ? "main_brain_note" : "knowledge_page",
    targetId: organizationId,
    metadata: { kind, organizationId, noteIds, count: noteIds.length, reason, agent: ctx.agent.name } as never,
  });
}

/** Restore soft-deleted notes. Used by the restore tool and by the admin console. */
export async function restoreNotes(input: { kind: NoteKind; organizationId: string | null; noteIds: string[] }): Promise<number> {
  if (input.noteIds.length === 0) return 0;
  if (input.kind === "master") {
    const restored = await mainBrain((tx) => tx.mainBrainNote.updateMany({ where: { id: { in: input.noteIds }, deletedAt: { not: null } }, data: { deletedAt: null } }));
    const pushed = await mainBrain((tx) => tx.mainBrainNote.findMany({ where: { id: { in: input.noteIds }, pushScope: { not: "NONE" } }, select: { id: true } }));
    if (pushed.length) await syncPushDown({ noteIds: pushed.map((n) => n.id) }).catch((error: unknown) => console.error("[agents] push-down after restore failed", error));
    return restored.count;
  }
  if (!input.organizationId) return 0;
  const restored = await tenantDb(input.organizationId).knowledgePage.updateMany({ where: { id: { in: input.noteIds }, deletedAt: { not: null } }, data: { deletedAt: null } });
  return restored.count;
}

export const PLATFORM_ORG_TOOLS: Tool[] = [
  {
    name: "rename_organization",
    title: "Rename an organization",
    description: "Change an organization's name and/or its web address (slug). The old address keeps redirecting. Needs a reason.",
    inputSchema: { type: "object", properties: { organization: { type: "string" }, name: { type: "string" }, slug: { type: "string" }, reason: { type: "string" } }, required: ["organization", "reason"], additionalProperties: false },
    readOnly: false,
    available: admin,
    run: async (ctx, args) => {
      const target = await org(args.organization);
      const reason = reasonOf(args);
      const name = str(args, "name", 120)?.trim().replace(/\s+/g, " ");
      const slug = str(args, "slug", 40)?.trim().toLowerCase();
      if (!name && !slug) throw new ToolError("Give a new name, a new slug, or both.");
      if (name) {
        await platformTx((tx) => tx.organization.update({ where: { id: target.id }, data: { name } }));
        await platformTx((tx) => tx.orgSettings.updateMany({ where: { organizationId: target.id }, data: { displayName: name } }));
      }
      if (slug && slug !== target.slug) {
        try {
          await changeOrganizationSlug(target.id, slug);
        } catch (error) {
          throw new ToolError(error instanceof Error ? error.message : "Could not change the slug.");
        }
      }
      await appendPlatformAudit({ actorId: ctx.agent.userId, action: "agents.admin.org.renamed", targetType: "organization", targetId: target.id, metadata: { reason, from: { name: target.name, slug: target.slug }, to: { name: name ?? target.name, slug: slug ?? target.slug } } });
      await appendOrgAudit(target.id, { actorId: ctx.agent.userId, action: "org.renamed", targetType: "organization", targetId: target.id, metadata: { name: name ?? target.name, slug: slug ?? target.slug } });
      return { data: { organization: { name: name ?? target.name, slug: slug ?? target.slug }, message: slug && slug !== target.slug ? `Renamed. ${target.slug} now redirects to ${slug}.` : "Renamed." }, targetType: "organization", targetId: target.id };
    },
  },
  {
    name: "create_brand",
    title: "Add a brand",
    description: "Add a brand to an organization (with its niche: finance, health or general). Needs a reason.",
    inputSchema: {
      type: "object",
      properties: { organization: { type: "string" }, name: { type: "string" }, niche: { type: "string", enum: ["finance", "health", "general"] }, audience: { type: "string" }, reason: { type: "string" } },
      required: ["organization", "name", "reason"],
      additionalProperties: false,
    },
    readOnly: false,
    available: admin,
    run: async (ctx, args) => {
      const target = await org(args.organization);
      const reason = reasonOf(args);
      const name = str(args, "name", 80)?.trim().replace(/\s+/g, " ");
      if (!name) throw new ToolError("name is required.");
      const niche = str(args, "niche", 20) ?? "general";
      if (!isNiche(niche)) throw new ToolError("niche must be finance, health or general.");
      const db = tenantDb(target.id);
      const existing = await db.brand.findMany({ select: { slug: true, name: true } });
      if (existing.some((b) => b.name.toLowerCase() === name.toLowerCase())) throw new ToolError(`${target.name} already has a brand called ${name}.`);
      const base = slugifyName(name) || "brand";
      let slug = base;
      for (let n = 2; existing.some((b) => b.slug === slug); n += 1) slug = `${base.slice(0, 36)}-${n}`;
      const created = await db.brand.create({ data: { organizationId: target.id, name, slug, niche, audience: str(args, "audience", 1000)?.trim() || null } });
      await db.workspace.create({ data: { organizationId: target.id, brandId: created.id, name: "General", slug: "general" } });
      await appendOrgAudit(target.id, { actorId: ctx.agent.userId, action: "brand.created", targetType: "brand", targetId: created.id, metadata: { name, via: "ai_agent" } });
      await appendPlatformAudit({ actorId: ctx.agent.userId, action: "agents.admin.brand.created", targetType: "brand", targetId: created.id, metadata: { reason, organization: target.slug, name, niche } });
      return { data: { organization: target.slug, brand: { id: created.id, name, slug, niche } }, targetType: "brand", targetId: created.id };
    },
  },
  {
    name: "update_brand",
    title: "Change a brand",
    description: "Rename a brand or change its niche or audience. Needs a reason.",
    inputSchema: {
      type: "object",
      properties: { organization: { type: "string" }, brand: { type: "string" }, name: { type: "string" }, niche: { type: "string", enum: ["finance", "health", "general"] }, audience: { type: "string" }, reason: { type: "string" } },
      required: ["organization", "brand", "reason"],
      additionalProperties: false,
    },
    readOnly: false,
    available: admin,
    run: async (ctx, args) => {
      const target = await org(args.organization);
      const found = await brand(target.id, args.brand);
      const reason = reasonOf(args);
      const name = str(args, "name", 80)?.trim().replace(/\s+/g, " ");
      const niche = str(args, "niche", 20);
      if (niche !== undefined && !isNiche(niche)) throw new ToolError("niche must be finance, health or general.");
      const audience = str(args, "audience", 1000);
      const data = { ...(name ? { name } : {}), ...(niche ? { niche } : {}), ...(audience !== undefined ? { audience: audience.trim() || null } : {}) };
      if (Object.keys(data).length === 0) throw new ToolError("Give a new name, niche or audience.");
      await tenantDb(target.id).brand.updateMany({ where: { id: found.id }, data });
      await appendOrgAudit(target.id, { actorId: ctx.agent.userId, action: "brand.updated", targetType: "brand", targetId: found.id, metadata: { ...data, via: "ai_agent" } });
      await appendPlatformAudit({ actorId: ctx.agent.userId, action: "agents.admin.brand.updated", targetType: "brand", targetId: found.id, metadata: { reason, organization: target.slug, from: found, to: data } });
      return { data: { organization: target.slug, brand: { ...found, ...data } }, targetType: "brand", targetId: found.id };
    },
  },
  {
    name: "delete_brand",
    title: "Remove an empty brand",
    description: "Remove a brand that has nothing in it (no Brain notes, websites, posts, Mini-Blogs, forms, funnels, publications, members or roles). Refused otherwise, and for an organization's last brand. Needs a reason.",
    inputSchema: { type: "object", properties: { organization: { type: "string" }, brand: { type: "string" }, reason: { type: "string" } }, required: ["organization", "brand", "reason"], additionalProperties: false },
    readOnly: false,
    available: admin,
    run: async (ctx, args) => {
      const target = await org(args.organization);
      const found = await brand(target.id, args.brand);
      const reason = reasonOf(args);
      const db = tenantDb(target.id);
      if ((await db.brand.count()) <= 1) throw new ToolError("An organization needs at least one brand.");
      const [notes, sites, blogs, forms, funnels, pubs, members, roles] = await Promise.all([
        db.knowledgePage.count({ where: { brandId: found.id } }),
        db.webSite.count({ where: { brandId: found.id } }),
        db.textSite.count({ where: { brandId: found.id } }),
        db.form.count({ where: { brandId: found.id } }),
        db.funnel.count({ where: { brandId: found.id } }),
        db.calendarPublication.count({ where: { brandId: found.id } }),
        db.membership.count({ where: { brandId: found.id } }),
        db.role.count({ where: { brandId: found.id } }),
      ]);
      const contents = Object.entries({ "Brain notes": notes, websites: sites, "Mini-Blogs": blogs, forms, funnels, publications: pubs, "members limited to it": members, "roles limited to it": roles }).filter(([, n]) => n > 0);
      if (contents.length) throw new ToolError(`${found.name} is not empty (${contents.map(([what, n]) => `${n} ${what}`).join(", ")}). Move or remove those first; a person can remove a full brand in Settings → Brands.`);
      await db.exclusion.deleteMany({ where: { brandId: found.id } });
      await db.brand.deleteMany({ where: { id: found.id } });
      await appendOrgAudit(target.id, { actorId: ctx.agent.userId, action: "brand.deleted", targetType: "brand", targetId: found.id, metadata: { name: found.name, via: "ai_agent" } });
      await appendPlatformAudit({ actorId: ctx.agent.userId, action: "agents.admin.brand.deleted", targetType: "brand", targetId: found.id, metadata: { reason, organization: target.slug, name: found.name } });
      return { data: { organization: target.slug, removed: found.name }, targetType: "brand", targetId: found.id };
    },
  },
  {
    name: "move_brain_notes",
    title: "Move Brain notes",
    description:
      "Move notes from one brand's Brain to another brand, in the same organization or another one. Their Master Brain copies follow (re-filed under the new organization and brand), so they keep feeding the Master Brain without duplicates. Use dry_run first to see what matches. Up to 1000 notes per call. Needs a reason.",
    inputSchema: {
      type: "object",
      properties: { organization: { type: "string", description: "Where the notes are now." }, brand: { type: "string", description: "Only notes of this brand (default: any brand)." }, ...selectionProps, to_organization: { type: "string", description: "Default: the same organization." }, to_brand: { type: "string" }, to_folder: { type: "string", description: "Put them in this folder (default: keep their folders)." }, reason: { type: "string" } },
      required: ["organization", "to_brand", "reason"],
      additionalProperties: false,
    },
    readOnly: false,
    available: admin,
    run: async (ctx, args) => {
      const from = await org(args.organization);
      const fromBrand = args.brand ? await brand(from.id, args.brand) : null;
      const to = args.to_organization ? await org(args.to_organization) : from;
      const toBrand = await brand(to.id, args.to_brand);
      const reason = reasonOf(args);
      const toFolder = str(args, "to_folder", 200)?.trim() || null;
      const where = { ...brainWhere(args, false), ...(fromBrand ? { brandId: fromBrand.id } : { brandId: { not: null } }) };
      const notes = await tenantDb(from.id).knowledgePage.findMany({ where, orderBy: { title: "asc" }, take: MAX_NOTES + 1 });
      if (notes.length > MAX_NOTES) throw new ToolError(`More than ${MAX_NOTES} notes match; narrow it down (folder, search, source) and move them in batches.`);
      const moving = notes.filter((n) => !(n.brandId === toBrand.id && from.id === to.id));
      if (args.dry_run === true) return { data: { would_move: moving.length, already_there: notes.length - moving.length, sample: moving.slice(0, 15).map((n) => ({ id: n.id, title: n.title, folder: n.folder, source: n.source })) } };
      let moved = 0;
      for (const note of moving) {
        if (from.id === to.id) {
          await tenantDb(from.id).knowledgePage.updateMany({ where: { id: note.id }, data: { brandId: toBrand.id, ...(toFolder ? { folder: toFolder } : {}) } });
          if (note.sourceRef) await repointMaster({ fromOrganizationId: from.id, toOrganizationId: to.id, brandId: toBrand.id, sourceRef: note.sourceRef, noteId: note.id });
        } else {
          // Another organization: create it there, then retire the original.
          const created = await platformTx(async (tx) => {
            const sourceRef = note.sourceRef && !(await tx.knowledgePage.findFirst({ where: { organizationId: to.id, sourceRef: note.sourceRef }, select: { id: true } })) ? note.sourceRef : null;
            return tx.knowledgePage.create({
              data: { organizationId: to.id, brandId: toBrand.id, title: note.title, slug: await uniqueBrainSlug(tx, to.id, note.title), body: note.body, folder: toFolder ?? note.folder, source: note.source, sourceRef, visibility: note.visibility, createdById: note.createdById },
            });
          });
          await tenantDb(from.id).knowledgePage.updateMany({ where: { id: note.id }, data: { deletedAt: new Date() } });
          if (note.sourceRef && created.sourceRef) await repointMaster({ fromOrganizationId: from.id, toOrganizationId: to.id, brandId: toBrand.id, sourceRef: note.sourceRef, noteId: created.id });
        }
        moved += 1;
      }
      await appendPlatformAudit({ actorId: ctx.agent.userId, action: "agents.admin.notes.moved", targetType: "knowledge_page", targetId: toBrand.id, metadata: { reason, from: from.slug, to: to.slug, toBrand: toBrand.name, count: moved } });
      await appendOrgAudit(to.id, { actorId: ctx.agent.userId, action: "brain.notes.moved_in", targetType: "brand", targetId: toBrand.id, metadata: { count: moved, from: from.slug } });
      return { data: { moved, to: `${to.name} · ${toBrand.name}`, message: `Moved ${moved} note${moved === 1 ? "" : "s"}. They keep feeding the Master Brain, filed under ${to.name} · ${toBrand.name}.` } };
    },
  },
  {
    name: "move_master_notes_to_brand",
    title: "Move Master Brain notes into a brand",
    description:
      "Give notes that live only in the Master Brain (imported or written there) to a brand: each becomes a note in that brand's Brain, and its Master Brain note becomes that note's learned copy, filed under the organization and brand. Nothing is duplicated. Notes already learned from a brand are skipped (use move_brain_notes for those). Use dry_run first. Up to 1000 per call. Needs a reason.",
    inputSchema: {
      type: "object",
      properties: { ...selectionProps, to_organization: { type: "string" }, to_brand: { type: "string" }, to_folder: { type: "string" }, reason: { type: "string" } },
      required: ["to_organization", "to_brand", "reason"],
      additionalProperties: false,
    },
    readOnly: false,
    available: admin,
    run: async (ctx, args) => {
      const to = await org(args.to_organization);
      const toBrand = await brand(to.id, args.to_brand);
      const reason = reasonOf(args);
      const toFolder = str(args, "to_folder", 200)?.trim() || null;
      const notes = await mainBrain((tx) => tx.mainBrainNote.findMany({ where: masterWhere(args, false), orderBy: { title: "asc" }, take: MAX_NOTES + 1 }));
      if (notes.length > MAX_NOTES) throw new ToolError(`More than ${MAX_NOTES} notes match; narrow it down and move them in batches.`);
      const movable = notes.filter((n) => !n.originNoteId);
      const skipped = notes.length - movable.length;
      if (args.dry_run === true) return { data: { would_move: movable.length, skipped_already_from_a_brand: skipped, sample: movable.slice(0, 15).map((n) => ({ id: n.id, title: n.title, folder: n.folder, source: n.source })) } };
      let moved = 0;
      for (const note of movable) {
        const sourceRef = `main:${note.id}`;
        const created = await platformTx(async (tx) => {
          const existing = await tx.knowledgePage.findFirst({ where: { organizationId: to.id, sourceRef }, select: { id: true } });
          if (existing) return existing;
          return tx.knowledgePage.create({
            data: { organizationId: to.id, brandId: toBrand.id, title: note.title, slug: await uniqueBrainSlug(tx, to.id, note.title), body: note.body, folder: toFolder ?? note.folder, source: note.source, sourceRef, visibility: "PRIVATE", createdById: ctx.agent.userId },
            select: { id: true },
          });
        });
        await mainBrain((tx) =>
          tx.mainBrainNote.update({
            where: { id: note.id },
            data: { key: learnedKey(to.id, sourceRef), originOrganizationId: to.id, originBrandId: toBrand.id, originSourceRef: sourceRef, originNoteId: created.id, ...(toFolder ? { folder: toFolder } : {}) },
          }),
        );
        moved += 1;
      }
      await appendPlatformAudit({ actorId: ctx.agent.userId, action: "agents.admin.master_notes.moved_to_brand", targetType: "brand", targetId: toBrand.id, metadata: { reason, organization: to.slug, brand: toBrand.name, count: moved, skipped } });
      await appendOrgAudit(to.id, { actorId: ctx.agent.userId, action: "brain.notes.moved_in", targetType: "brand", targetId: toBrand.id, metadata: { count: moved, from: "master_brain" } });
      return { data: { moved, skipped_already_from_a_brand: skipped, to: `${to.name} · ${toBrand.name}`, message: `Moved ${moved} Master Brain note${moved === 1 ? "" : "s"} into ${toBrand.name}. They stay in the Master Brain, filed under ${to.name} · ${toBrand.name}.` } };
    },
  },
  {
    name: "delete_notes",
    title: "Delete notes",
    description:
      "Delete notes from a brand's Brain (kind brain, with organization) or from the Master Brain (kind master). Deletes can be undone: restore_notes, or staff in the admin console → AI Agents. Master Brain notes are also withdrawn from brands they were pushed to. Use dry_run first. Up to 1000 per call. Needs a reason.",
    inputSchema: {
      type: "object",
      properties: { kind: { type: "string", enum: ["brain", "master"] }, organization: { type: "string", description: "For kind brain." }, brand: { type: "string", description: "For kind brain: only this brand." }, ...selectionProps, reason: { type: "string" } },
      required: ["kind", "reason"],
      additionalProperties: false,
    },
    readOnly: false,
    available: admin,
    run: async (ctx, args) => {
      const reason = reasonOf(args);
      if (args.kind === "master") {
        const notes = await mainBrain((tx) => tx.mainBrainNote.findMany({ where: masterWhere(args, false), select: { id: true, title: true, pushScope: true, pushedAt: true }, take: MAX_NOTES + 1 }));
        if (notes.length > MAX_NOTES) throw new ToolError(`More than ${MAX_NOTES} notes match; narrow it down.`);
        if (args.dry_run === true) return { data: { would_delete: notes.length, sample: notes.slice(0, 15).map((n) => ({ id: n.id, title: n.title })) } };
        const noteIds = notes.map((n) => n.id);
        await mainBrain((tx) => tx.mainBrainNote.updateMany({ where: { id: { in: noteIds } }, data: { deletedAt: new Date(), updatedById: ctx.agent.userId } }));
        const pushed = notes.filter((n) => n.pushScope !== "NONE" || n.pushedAt).map((n) => n.id);
        if (pushed.length) await syncPushDown({ noteIds: pushed }).catch((error: unknown) => console.error("[agents] push-down after delete failed", error));
        await auditNotes(ctx, "deleted", "master", null, noteIds, reason);
        return { data: { deleted: noteIds.length, note_ids: noteIds, message: `Deleted ${noteIds.length} Master Brain note${noteIds.length === 1 ? "" : "s"}. restore_notes with these ids undoes it.` } };
      }
      if (args.kind !== "brain") throw new ToolError("kind must be brain or master.");
      const target = await org(args.organization);
      const onlyBrand = args.brand ? await brand(target.id, args.brand) : null;
      const notes = await tenantDb(target.id).knowledgePage.findMany({ where: { ...brainWhere(args, false), ...(onlyBrand ? { brandId: onlyBrand.id } : {}) }, select: { id: true, title: true }, take: MAX_NOTES + 1 });
      if (notes.length > MAX_NOTES) throw new ToolError(`More than ${MAX_NOTES} notes match; narrow it down.`);
      if (args.dry_run === true) return { data: { would_delete: notes.length, sample: notes.slice(0, 15) } };
      const noteIds = notes.map((n) => n.id);
      await tenantDb(target.id).knowledgePage.updateMany({ where: { id: { in: noteIds } }, data: { deletedAt: new Date(), updatedById: ctx.agent.userId } });
      await auditNotes(ctx, "deleted", "brain", target.id, noteIds, reason);
      await appendOrgAudit(target.id, { actorId: ctx.agent.userId, action: "brain.notes.deleted", targetType: "knowledge_page", metadata: { count: noteIds.length } });
      return { data: { deleted: noteIds.length, note_ids: noteIds, message: `Deleted ${noteIds.length} note${noteIds.length === 1 ? "" : "s"} from ${target.name}. restore_notes with these ids undoes it.` } };
    },
  },
  {
    name: "list_deleted_notes",
    title: "List deleted notes",
    description: "Deleted notes that can be restored: a brand Brain's (kind brain, with organization) or the Master Brain's (kind master), newest first.",
    inputSchema: { type: "object", properties: { kind: { type: "string", enum: ["brain", "master"] }, organization: { type: "string" }, search: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 200 } }, required: ["kind"], additionalProperties: false },
    readOnly: true,
    available: admin,
    run: async (_ctx, args) => {
      const take = Math.min(Math.max(Number(args.limit ?? 50) || 50, 1), 200);
      const search = str(args, "search", 200)?.trim();
      const title = search ? { title: { contains: search, mode: "insensitive" as const } } : {};
      if (args.kind === "master") {
        const notes = await mainBrain((tx) => tx.mainBrainNote.findMany({ where: { deletedAt: { not: null }, ...title }, orderBy: { deletedAt: "desc" }, take, select: { id: true, title: true, folder: true, deletedAt: true } }));
        return { data: { notes: notes.map((n) => ({ ...n, deletedAt: n.deletedAt?.toISOString() })) } };
      }
      const target = await org(args.organization);
      const notes = await tenantDb(target.id).knowledgePage.findMany({ where: { deletedAt: { not: null }, ...title }, orderBy: { deletedAt: "desc" }, take, select: { id: true, title: true, folder: true, brandId: true, deletedAt: true } });
      return { data: { organization: target.slug, notes: notes.map((n) => ({ ...n, deletedAt: n.deletedAt?.toISOString() })) } };
    },
  },
  {
    name: "restore_notes",
    title: "Restore deleted notes",
    description: "Bring deleted notes back: kind brain (with organization) or master, by note_ids (from delete_notes or list_deleted_notes). Needs a reason.",
    inputSchema: { type: "object", properties: { kind: { type: "string", enum: ["brain", "master"] }, organization: { type: "string" }, note_ids: { type: "array", items: { type: "string" } }, reason: { type: "string" } }, required: ["kind", "note_ids", "reason"], additionalProperties: false },
    readOnly: false,
    available: admin,
    run: async (ctx, args) => {
      const reason = reasonOf(args);
      const noteIds = ids(args) ?? [];
      if (args.kind !== "master" && args.kind !== "brain") throw new ToolError("kind must be brain or master.");
      const target = args.kind === "brain" ? await org(args.organization) : null;
      const restored = await restoreNotes({ kind: args.kind, organizationId: target?.id ?? null, noteIds });
      await auditNotes(ctx, "restored", args.kind, target?.id ?? null, noteIds, reason);
      return { data: { restored, message: `Restored ${restored} note${restored === 1 ? "" : "s"}.` } };
    },
  },
];

