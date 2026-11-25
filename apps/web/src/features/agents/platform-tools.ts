import { AGENT_EMAIL_DOMAIN, agentPlatformLabel, isAgentEmail, parseAppAccessChoice } from "@pubcommand/core";
import {
  addOrganizationMember,
  appendPlatformAudit,
  assignOrganizationPlan,
  entitledFromState,
  loadEntitlementState,
  platformTx,
  rawPrisma,
  setOrganizationAppAccess,
  setOrganizationSuspended,
} from "@pubcommand/db";
import { moduleRegistry } from "@pubcommand/modules";
import { JOBS } from "@/jobs";
import { runJobNow } from "@/lib/jobs/runner";
import { CONSOLE_ORG_SLUG } from "@/lib/console-workspace";
import { frontmatterNiche, withNicheFrontmatter, type NoteNiche } from "../../../../../modules/knowledge/main-brain";
import { mainBrain } from "../main-brain/db";
import { uniqueMainSlug } from "../main-brain/learn";
import { getMainNote, mainFolderCounts, mainStats, provenanceNames, searchMainNotes } from "../main-brain/notes";
import { syncPushDown } from "../main-brain/push";
import type { AgentContext } from "./context";
import { ToolError, UUID, limit, oneOf, str, uuid, type Tool } from "./tool-kit";

/**
 * Tools only platform agents get: a SUPER_ADMIN's agent on the admin console host.
 * - Master Brain: search, read, list, save (the same Master Brain staff use in the console).
 * - Platform monitoring (read-only): organizations, users, audit logs, jobs, AI usage, agents.
 * - Admin actions, only when the agent's "Can make admin changes" is on. Each one needs a reason
 *   and is in the platform audit log under the agent. Nothing irreversible or security-sensitive
 *   (no deletes or purges, passwords, 2FA, impersonation, staff changes, domains).
 */

const NOTE_NICHES: readonly NoteNiche[] = ["finance", "health", "general"];
const platform = (ctx: AgentContext) => ctx.scope === "platform";
const admin = (ctx: AgentContext) => ctx.scope === "platform" && ctx.allowAdminActions;
const DAY = 86_400_000;
const notAgent = { email: { not: { endsWith: `@${AGENT_EMAIL_DOMAIN}` } } };

async function findOrganization(value: string | undefined) {
  const wanted = value?.trim().toLowerCase();
  if (!wanted) throw new ToolError("organization is required (slug or id; see list_organizations).");
  const org = await rawPrisma().organization.findFirst({
    where: { OR: [{ slug: wanted }, ...(UUID.test(wanted) ? [{ id: wanted }] : [])], NOT: { slug: CONSOLE_ORG_SLUG } },
    include: { plan: { select: { key: true, name: true } } },
  });
  if (!org) throw new ToolError("No organization with that slug or id. Call list_organizations.");
  return org;
}

function reasonOf(args: Record<string, unknown>): string {
  const reason = str(args, "reason", 500)?.trim();
  if (!reason || reason.length < 5) throw new ToolError("reason is required: say briefly why (it goes in the audit log).");
  return reason;
}

async function auditAdmin(ctx: AgentContext, action: string, targetType: string, targetId: string, metadata: Record<string, unknown>) {
  await appendPlatformAudit({ actorId: ctx.agent.userId, action: `agents.admin.${action}`, targetType, targetId, metadata: { ...metadata, agent: ctx.agent.name, owner: ctx.agent.ownerUserId } as never });
}

const iso = (date: Date | null | undefined) => (date ? date.toISOString() : null);
const orgArgRequired = { organization: { type: "string", description: "Organization slug or id." } };
const reasonArg = { reason: { type: "string", description: "Why (kept in the platform audit log)." } };

export const PLATFORM_TOOLS: Tool[] = [
  // ── Master Brain ──────────────────────────────────────────────────────────
  {
    name: "search_master_brain",
    title: "Search the Master Brain",
    description: "Full-text search of the platform Master Brain: everything learned from every organization, plus imported and authored notes. Returns titles, snippets and where each note came from.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" }, folder: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 50 } },
      required: ["query"],
      additionalProperties: false,
    },
    readOnly: true,
    available: platform,
    run: async (_ctx, args) => {
      const query = str(args, "query", 300)?.trim();
      if (!query) throw new ToolError("query is required.");
      const folder = str(args, "folder", 200)?.trim() || null;
      const max = Math.min(limit(args, 15), 50);
      let hits = await searchMainNotes({ query, mode: "all", limit: max, filter: { folder } });
      if (hits.length < Math.min(3, max)) {
        const seen = new Set(hits.map((hit) => hit.id));
        const more = await searchMainNotes({ query, mode: "any", limit: max, filter: { folder } });
        hits = [...hits, ...more.filter((hit) => !seen.has(hit.id))].slice(0, max);
      }
      const names = await provenanceNames();
      return {
        data: {
          results: hits.map((hit) => ({
            id: hit.id,
            title: hit.title,
            folder: hit.folder,
            source: hit.source,
            from: hit.originBrandId ? (names.brands.get(hit.originBrandId)?.name ?? "a brand") : hit.originOrganizationId ? (names.orgs.get(hit.originOrganizationId)?.name ?? "an organization") : "Platform",
            updated_at: iso(hit.updatedAt),
            snippet: hit.snippet.replace(/[«»]/g, ""),
          })),
        },
      };
    },
  },
  {
    name: "read_master_note",
    title: "Read a Master Brain note",
    description: "One Master Brain note in full.",
    inputSchema: { type: "object", properties: { note_id: { type: "string" } }, required: ["note_id"], additionalProperties: false },
    readOnly: true,
    available: platform,
    run: async (_ctx, args) => {
      const note = await getMainNote(uuid(args, "note_id")!);
      if (!note) throw new ToolError("No Master Brain note with that id.");
      const names = await provenanceNames();
      return {
        data: {
          id: note.id,
          title: note.title,
          folder: note.folder,
          origin: note.origin,
          source: note.source,
          from: [note.originOrganizationId ? names.orgs.get(note.originOrganizationId)?.name : null, note.originBrandId ? names.brands.get(note.originBrandId)?.name : null].filter(Boolean).join(" · ") || "Platform",
          pushed_to_brands: note.pushScope,
          updated_at: iso(note.updatedAt),
          body: note.body,
        },
        targetType: "main_brain_note",
        targetId: note.id,
      };
    },
  },
  {
    name: "list_master_brain",
    title: "List the Master Brain",
    description: "Without folder: totals, folders and sources of the Master Brain. With folder: its newest notes.",
    inputSchema: { type: "object", properties: { folder: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false },
    readOnly: true,
    available: platform,
    run: async (_ctx, args) => {
      const folder = str(args, "folder", 200)?.trim();
      if (folder) {
        const notes = await mainBrain((tx) =>
          tx.mainBrainNote.findMany({
            where: { deletedAt: null, OR: [{ folder }, { folder: { startsWith: `${folder}/` } }] },
            orderBy: { updatedAt: "desc" },
            take: limit(args, 40),
            select: { id: true, title: true, folder: true, source: true, updatedAt: true },
          }),
        );
        return { data: { folder, notes: notes.map((note) => ({ ...note, updatedAt: iso(note.updatedAt) })) } };
      }
      const [stats, folders] = await Promise.all([mainStats(), mainFolderCounts()]);
      return { data: { ...stats, folders: folders.sort((a, b) => b.count - a.count).slice(0, 100).map((row) => ({ folder: row.folder ?? "Top level", notes: row.count })) } };
    },
  },
  {
    name: "save_master_note",
    title: "Save a Master Brain note",
    description: "Add a note to the Master Brain, or update one (note_id). Updating a note that is pushed down to brands also updates their copies.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string", description: "Markdown." },
        folder: { type: "string" },
        niche: { type: "string", enum: [...NOTE_NICHES], description: "Which brands may receive it: finance, health, or general (all). Default: the body's niche: line, else the note's current niche, else general." },
        note_id: { type: "string" },
      },
      required: ["title", "body"],
      additionalProperties: false,
    },
    readOnly: false,
    available: platform,
    run: async (ctx, args) => {
      const title = str(args, "title", 200)?.replace(/\s+/g, " ").trim();
      const body = str(args, "body", 200_000)?.replace(/\r\n/g, "\n").trim();
      if (!title || !body) throw new ToolError("title and body are required.");
      const folder = str(args, "folder", 200)?.trim() || null;
      const noteId = uuid(args, "note_id", false);
      // Health and finance never mix: every note carries its niche, like BrainChat's.
      const picked = oneOf(args, "niche", NOTE_NICHES) as NoteNiche | undefined;
      if (noteId) {
        const existing = await getMainNote(noteId);
        if (!existing) throw new ToolError("No Master Brain note with that id; leave note_id out to add a new one.");
        const niche = picked ?? frontmatterNiche(body) ?? (existing.niche as NoteNiche);
        await mainBrain((tx) => tx.mainBrainNote.update({ where: { id: existing.id }, data: { title, body: withNicheFrontmatter(body, niche), niche, folder, updatedById: ctx.agent.userId, editedAt: new Date() } }));
        await appendPlatformAudit({ actorId: ctx.agent.userId, action: "main_brain.note.updated", targetType: "main_brain_note", targetId: existing.id, metadata: { via: "ai_agent" } });
        if (existing.pushScope !== "NONE") await syncPushDown({ noteIds: [existing.id] }).catch((error: unknown) => console.error("[agents] push-down failed", error));
        return { data: { id: existing.id, message: "Updated." }, targetType: "main_brain_note", targetId: existing.id };
      }
      const note = await mainBrain(async (tx) =>
        tx.mainBrainNote.create({
          data: {
            key: `note:${crypto.randomUUID()}`,
            title,
            slug: await uniqueMainSlug(tx, title),
            body: withNicheFrontmatter(body, picked ?? frontmatterNiche(body) ?? "general"),
            niche: picked ?? frontmatterNiche(body) ?? "general",
            folder,
            origin: "AUTHORED",
            source: "ai-agent",
            createdById: ctx.agent.userId,
          },
          select: { id: true },
        }),
      );
      await appendPlatformAudit({ actorId: ctx.agent.userId, action: "main_brain.note.created", targetType: "main_brain_note", targetId: note.id, metadata: { via: "ai_agent" } });
      return { data: { id: note.id, message: "Saved." }, targetType: "main_brain_note", targetId: note.id };
    },
  },

  // ── Monitoring (read-only) ────────────────────────────────────────────────
  {
    name: "platform_overview",
    title: "Platform overview",
    description: "Health of the whole platform: organizations, people, staff, AI agents, failed jobs, AI usage and the Master Brain.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    readOnly: true,
    available: platform,
    run: async () => {
      const since = new Date(Date.now() - DAY);
      const week = new Date(Date.now() - 7 * DAY);
      const db = rawPrisma();
      const [orgs, suspended, deleted, people, staff, jobsFailed, jobsRunning, agentCounts, usage, brain] = await Promise.all([
        db.organization.count({ where: { deletedAt: null, NOT: { slug: CONSOLE_ORG_SLUG } } }),
        db.organization.count({ where: { deletedAt: null, suspendedAt: { not: null } } }),
        db.organization.count({ where: { deletedAt: { not: null } } }),
        db.user.count({ where: { deletedAt: null, ...notAgent } }),
        db.platformStaff.count({ where: { disabledAt: null } }),
        db.jobRun.findMany({ where: { status: "failed", startedAt: { gte: since } }, select: { job: true, error: true, startedAt: true }, orderBy: { startedAt: "desc" }, take: 10 }),
        db.jobRun.count({ where: { status: "running" } }),
        platformTx((tx) => tx.aiAgent.groupBy({ by: ["scope"], where: { removedAt: null }, _count: { _all: true } })),
        platformTx((tx) => tx.aiUsageLog.aggregate({ where: { createdAt: { gte: week } }, _sum: { inputTokens: true, outputTokens: true }, _count: { _all: true } })),
        mainStats(),
      ]);
      return {
        data: {
          organizations: { active: orgs - suspended, suspended, deleted_restorable: deleted },
          people,
          active_staff: staff,
          ai_agents: Object.fromEntries(agentCounts.map((row) => [row.scope, row._count._all])),
          jobs: { running: jobsRunning, failed_last_24h: jobsFailed.map((run) => ({ job: run.job, at: iso(run.startedAt), error: run.error?.slice(0, 300) ?? null })) },
          platform_ai_usage_last_7_days: { calls: usage._count._all, input_tokens: usage._sum.inputTokens ?? 0, output_tokens: usage._sum.outputTokens ?? 0 },
          master_brain: { notes: brain.total, pushed_to_brands: brain.pushed },
        },
      };
    },
  },
  {
    name: "list_organizations",
    title: "List organizations",
    description: "Organizations on the platform with plan, seats (people only) and status. Filter by words in the name or slug, and by status.",
    inputSchema: {
      type: "object",
      properties: { search: { type: "string" }, status: { type: "string", enum: ["active", "suspended", "deleted", "all"] }, limit: { type: "integer", minimum: 1, maximum: 100 } },
      additionalProperties: false,
    },
    readOnly: true,
    available: platform,
    run: async (_ctx, args) => {
      const status = oneOf(args, "status", ["active", "suspended", "deleted", "all"] as const, "active");
      const search = str(args, "search", 100)?.trim();
      const orgs = await rawPrisma().organization.findMany({
        where: {
          NOT: { slug: CONSOLE_ORG_SLUG },
          ...(status === "active" ? { deletedAt: null, suspendedAt: null } : status === "suspended" ? { deletedAt: null, suspendedAt: { not: null } } : status === "deleted" ? { deletedAt: { not: null } } : {}),
          ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" as const } }, { slug: { contains: search.toLowerCase() } }] } : {}),
        },
        include: { plan: { select: { name: true } }, memberships: { where: { status: { in: ["ACTIVE", "INVITED"] }, user: notAgent }, select: { id: true } } },
        orderBy: { name: "asc" },
        take: limit(args, 50),
      });
      return {
        data: {
          organizations: orgs.map((org) => ({
            id: org.id,
            name: org.name,
            slug: org.slug,
            plan: org.plan.name,
            seats: `${org.memberships.length}/${org.seatLimit}`,
            suspended: Boolean(org.suspendedAt),
            deleted: Boolean(org.deletedAt),
            created_at: iso(org.createdAt),
          })),
        },
      };
    },
  },
  {
    name: "get_organization",
    title: "Get an organization",
    description: "One organization in detail: plan, apps it has, people and their roles, AI agents, brands, AI usage (30 days) and its latest activity.",
    inputSchema: { type: "object", properties: { ...orgArgRequired }, required: ["organization"], additionalProperties: false },
    readOnly: true,
    available: platform,
    run: async (_ctx, args) => {
      const org = await findOrganization(str(args, "organization", 100));
      const since = new Date(Date.now() - 30 * DAY);
      const [members, state, details] = await Promise.all([
        rawPrisma().membership.findMany({ where: { organizationId: org.id }, include: { user: { select: { email: true, name: true } }, role: { select: { name: true } } }, orderBy: { createdAt: "asc" } }),
        loadEntitlementState(org.id),
        platformTx((tx) =>
          Promise.all([
            tx.brand.findMany({ where: { organizationId: org.id }, select: { name: true, slug: true, niche: true } }),
            tx.aiAgent.findMany({ where: { organizationId: org.id, removedAt: null }, select: { name: true, platform: true, ownerUserId: true, pausedAt: true, lastActiveAt: true } }),
            tx.aiUsageLog.groupBy({ by: ["moduleId"], where: { organizationId: org.id, createdAt: { gte: since } }, _sum: { inputTokens: true, outputTokens: true }, _count: { _all: true } }),
            tx.auditLog.findMany({ where: { organizationId: org.id }, orderBy: { createdAt: "desc" }, take: 15, select: { action: true, actorId: true, targetType: true, createdAt: true } }),
          ]),
        ),
      ]);
      const [brands, agents, usage, audit] = details;
      const people = members.filter((member) => !isAgentEmail(member.user.email));
      const names = new Map(members.map((member) => [member.userId, member.user.name || member.user.email]));
      return {
        data: {
          id: org.id,
          name: org.name,
          slug: org.slug,
          plan: org.plan.name,
          seats: `${people.filter((member) => member.status !== "DISABLED").length}/${org.seatLimit}`,
          suspended: Boolean(org.suspendedAt),
          deleted: Boolean(org.deletedAt),
          apps: state ? entitledFromState(state) : [],
          brands,
          people: people.map((member) => ({ email: member.user.email, name: member.user.name, role: member.role.name, status: member.status })),
          ai_agents: agents.map((agent) => ({ name: agent.name, platform: agentPlatformLabel(agent.platform), owner: names.get(agent.ownerUserId) ?? null, paused: Boolean(agent.pausedAt), last_active: iso(agent.lastActiveAt) })),
          ai_usage_30_days: usage.map((row) => ({ app: row.moduleId, calls: row._count._all, input_tokens: row._sum.inputTokens ?? 0, output_tokens: row._sum.outputTokens ?? 0 })),
          recent_activity: audit.map((row) => ({ action: row.action, by: row.actorId ? (names.get(row.actorId) ?? row.actorId) : null, target: row.targetType, at: iso(row.createdAt) })),
        },
        targetType: "organization",
        targetId: org.id,
      };
    },
  },
  {
    name: "list_users",
    title: "List users",
    description: "People on the platform (not agents), with their organizations and staff role. Filter by words in the email or name.",
    inputSchema: { type: "object", properties: { search: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false },
    readOnly: true,
    available: platform,
    run: async (_ctx, args) => {
      const search = str(args, "search", 100)?.trim();
      const users = await rawPrisma().user.findMany({
        where: { deletedAt: null, AND: [notAgent, ...(search ? [{ OR: [{ email: { contains: search, mode: "insensitive" as const } }, { name: { contains: search, mode: "insensitive" as const } }] }] : [])] },
        include: { staff: { select: { role: true, disabledAt: true } }, memberships: { include: { organization: { select: { slug: true } }, role: { select: { name: true } } } } },
        orderBy: { createdAt: "desc" },
        take: limit(args, 50),
      });
      return {
        data: {
          users: users.map((user) => ({
            id: user.id,
            email: user.email,
            name: user.name,
            disabled: Boolean(user.disabledAt),
            has_password: Boolean(user.passwordHash),
            staff_role: user.staff && !user.staff.disabledAt ? user.staff.role : null,
            organizations: user.memberships.map((member) => `${member.organization.slug} (${member.role.name}, ${member.status.toLowerCase()})`),
            created_at: iso(user.createdAt),
          })),
        },
      };
    },
  },
  {
    name: "platform_audit_log",
    title: "Platform audit log",
    description: "What staff (and platform agents) did on the platform, newest first. Filter by an action prefix, e.g. org., staff., agents.",
    inputSchema: { type: "object", properties: { action: { type: "string" }, days: { type: "integer", minimum: 1, maximum: 365 }, limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false },
    readOnly: true,
    available: platform,
    run: async (_ctx, args) => {
      const action = str(args, "action", 80)?.trim();
      const days = Math.min(Math.max(Number(args.days ?? 30) || 30, 1), 365);
      const rows = await rawPrisma().platformAuditLog.findMany({
        where: { createdAt: { gte: new Date(Date.now() - days * DAY) }, ...(action ? { action: { startsWith: action } } : {}) },
        orderBy: { createdAt: "desc" },
        take: limit(args, 50),
      });
      const actors = await rawPrisma().user.findMany({ where: { id: { in: rows.map((row) => row.actorId).filter((id): id is string => Boolean(id)) } }, select: { id: true, email: true, name: true } });
      const who = new Map(actors.map((actor) => [actor.id, isAgentEmail(actor.email) ? `${actor.name} (AI agent)` : actor.email]));
      return { data: { entries: rows.map((row) => ({ at: iso(row.createdAt), action: row.action, by: row.actorId ? (who.get(row.actorId) ?? row.actorId) : null, target: `${row.targetType}${row.targetId ? ` ${row.targetId}` : ""}`, details: row.metadata })) } };
    },
  },
  {
    name: "organization_audit_log",
    title: "Organization activity",
    description: "An organization's own activity log, newest first.",
    inputSchema: { type: "object", properties: { ...orgArgRequired, action: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, required: ["organization"], additionalProperties: false },
    readOnly: true,
    available: platform,
    run: async (_ctx, args) => {
      const org = await findOrganization(str(args, "organization", 100));
      const action = str(args, "action", 80)?.trim();
      const rows = await platformTx((tx) => tx.auditLog.findMany({ where: { organizationId: org.id, ...(action ? { action: { startsWith: action } } : {}) }, orderBy: { createdAt: "desc" }, take: limit(args, 50) }));
      const actors = await rawPrisma().user.findMany({ where: { id: { in: rows.map((row) => row.actorId).filter((id): id is string => Boolean(id)) } }, select: { id: true, email: true, name: true } });
      const who = new Map(actors.map((actor) => [actor.id, isAgentEmail(actor.email) ? `${actor.name} (AI agent)` : actor.email]));
      return { data: { organization: org.name, entries: rows.map((row) => ({ at: iso(row.createdAt), action: row.action, by: row.actorId ? (who.get(row.actorId) ?? row.actorId) : null, target: `${row.targetType}${row.targetId ? ` ${row.targetId}` : ""}`, details: row.metadata })) } };
    },
  },
  {
    name: "list_job_runs",
    title: "Background jobs",
    description: "The scheduled background jobs and their recent runs. Filter by job name or status (running, done, failed, skipped).",
    inputSchema: { type: "object", properties: { job: { type: "string" }, status: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false },
    readOnly: true,
    available: platform,
    run: async (_ctx, args) => {
      const job = str(args, "job", 100)?.trim();
      const status = str(args, "status", 20)?.trim();
      const runs = await rawPrisma().jobRun.findMany({ where: { ...(job ? { job } : {}), ...(status ? { status } : {}) }, orderBy: { startedAt: "desc" }, take: limit(args, 30) });
      return {
        data: {
          jobs: JOBS.map((item) => ({ name: item.name, description: item.description, schedule: item.schedule })),
          runs: runs.map((run) => ({ job: run.job, status: run.status, trigger: run.trigger, started_at: iso(run.startedAt), duration_ms: run.durationMs, error: run.error?.slice(0, 500) ?? null })),
        },
      };
    },
  },
  {
    name: "ai_usage",
    title: "AI usage",
    description: "PubCommand's own AI usage (tokens) by organization and app over the last N days. AI agents' usage is on their owners' accounts and is not here.",
    inputSchema: { type: "object", properties: { days: { type: "integer", minimum: 1, maximum: 365 }, organization: { type: "string", description: "Only this organization (slug or id)." } }, additionalProperties: false },
    readOnly: true,
    available: platform,
    run: async (_ctx, args) => {
      const days = Math.min(Math.max(Number(args.days ?? 30) || 30, 1), 365);
      const org = args.organization ? await findOrganization(str(args, "organization", 100)) : null;
      const rows = await platformTx((tx) =>
        tx.aiUsageLog.groupBy({
          by: ["organizationId", "moduleId"],
          where: { createdAt: { gte: new Date(Date.now() - days * DAY) }, ...(org ? { organizationId: org.id } : {}) },
          _sum: { inputTokens: true, outputTokens: true },
          _count: { _all: true },
        }),
      );
      const orgs = await rawPrisma().organization.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.organizationId))] } }, select: { id: true, slug: true } });
      const slug = new Map(orgs.map((item) => [item.id, item.slug]));
      return {
        data: {
          days,
          usage: rows
            .map((row) => ({ organization: slug.get(row.organizationId) ?? row.organizationId, app: row.moduleId, calls: row._count._all, input_tokens: row._sum.inputTokens ?? 0, output_tokens: row._sum.outputTokens ?? 0 }))
            .sort((a, b) => b.input_tokens + b.output_tokens - (a.input_tokens + a.output_tokens)),
        },
      };
    },
  },
  {
    name: "list_ai_agents",
    title: "List AI agents",
    description: "Every AI agent on the platform (organization agents and platform agents): owner, platform, status, last activity and calls in the last 24 hours.",
    inputSchema: { type: "object", properties: { organization: { type: "string", description: "Only this organization (slug or id)." } }, additionalProperties: false },
    readOnly: true,
    available: platform,
    run: async (_ctx, args) => {
      const org = args.organization ? await findOrganization(str(args, "organization", 100)) : null;
      const since = new Date(Date.now() - DAY);
      const [agents, calls] = await platformTx((tx) =>
        Promise.all([
          tx.aiAgent.findMany({ where: { removedAt: null, ...(org ? { organizationId: org.id } : {}) }, orderBy: { createdAt: "asc" } }),
          tx.aiAgentCall.groupBy({ by: ["agentId", "status"], where: { createdAt: { gte: since }, ...(org ? { organizationId: org.id } : {}) }, _count: { _all: true } }),
        ]),
      );
      const [orgs, owners] = await Promise.all([
        rawPrisma().organization.findMany({ where: { id: { in: [...new Set(agents.map((agent) => agent.organizationId))] } }, select: { id: true, slug: true } }),
        rawPrisma().user.findMany({ where: { id: { in: [...new Set(agents.map((agent) => agent.ownerUserId))] } }, select: { id: true, email: true } }),
      ]);
      const slug = new Map(orgs.map((item) => [item.id, item.slug]));
      const owner = new Map(owners.map((item) => [item.id, item.email]));
      return {
        data: {
          agents: agents.map((agent) => {
            const mine = calls.filter((row) => row.agentId === agent.id);
            return {
              name: agent.name,
              kind: agent.scope,
              organization: agent.scope === "platform" ? "(platform)" : slug.get(agent.organizationId),
              platform: agentPlatformLabel(agent.platform),
              owner: owner.get(agent.ownerUserId) ?? null,
              paused: Boolean(agent.pausedAt),
              last_active: iso(agent.lastActiveAt),
              calls_24h: mine.reduce((sum, row) => sum + row._count._all, 0),
              errors_24h: mine.filter((row) => row.status !== "ok").reduce((sum, row) => sum + row._count._all, 0),
            };
          }),
        },
      };
    },
  },

  // ── Admin actions (platform agents with "Can make admin changes") ─────────
  {
    name: "suspend_organization",
    title: "Suspend or resume an organization",
    description: "Suspend an organization (its people cannot use it; nothing is deleted) or resume it. Needs a reason.",
    inputSchema: { type: "object", properties: { ...orgArgRequired, suspend: { type: "boolean", description: "true to suspend, false to resume." }, ...reasonArg }, required: ["organization", "suspend", "reason"], additionalProperties: false },
    readOnly: false,
    available: admin,
    run: async (ctx, args) => {
      const org = await findOrganization(str(args, "organization", 100));
      if (typeof args.suspend !== "boolean") throw new ToolError("suspend must be true or false.");
      const reason = reasonOf(args);
      await setOrganizationSuspended({ organizationId: org.id, suspend: args.suspend, actorId: ctx.agent.userId });
      await auditAdmin(ctx, args.suspend ? "org.suspended" : "org.resumed", "organization", org.id, { reason });
      return { data: { organization: org.slug, suspended: args.suspend, message: args.suspend ? "Suspended." : "Resumed." }, targetType: "organization", targetId: org.id };
    },
  },
  {
    name: "change_organization_plan",
    title: "Change an organization's plan",
    description: "Move an organization to another plan (by plan key or name). Needs a reason.",
    inputSchema: { type: "object", properties: { ...orgArgRequired, plan: { type: "string", description: "Plan key or name." }, ...reasonArg }, required: ["organization", "plan", "reason"], additionalProperties: false },
    readOnly: false,
    available: admin,
    run: async (ctx, args) => {
      const org = await findOrganization(str(args, "organization", 100));
      const wanted = str(args, "plan", 100)?.trim().toLowerCase() ?? "";
      const plans = await rawPrisma().plan.findMany({ where: { archivedAt: null }, select: { id: true, key: true, name: true } });
      const plan = plans.find((item) => item.key.toLowerCase() === wanted || item.name.toLowerCase() === wanted);
      if (!plan) throw new ToolError(`No active plan "${wanted}". Plans: ${plans.map((item) => item.key).join(", ")}.`);
      const reason = reasonOf(args);
      const result = await assignOrganizationPlan({ organizationId: org.id, planId: plan.id, actorId: ctx.agent.userId });
      await auditAdmin(ctx, "org.plan_changed", "organization", org.id, { reason, from: org.plan.key, to: plan.key });
      return { data: { organization: org.slug, plan: result.name, message: `Now on ${result.name}.` }, targetType: "organization", targetId: org.id };
    },
  },
  {
    name: "set_organization_app_access",
    title: "Allow or block an app for an organization",
    description: "Override the plan for one app in one organization: allowed, blocked, or plan (follow the plan). Data is kept either way. Needs a reason.",
    inputSchema: {
      type: "object",
      properties: { ...orgArgRequired, app: { type: "string", description: "App (module) id, e.g. websites, miniblog, knowledge." }, access: { type: "string", enum: ["allowed", "blocked", "plan"] }, ...reasonArg },
      required: ["organization", "app", "access", "reason"],
      additionalProperties: false,
    },
    readOnly: false,
    available: admin,
    run: async (ctx, args) => {
      const org = await findOrganization(str(args, "organization", 100));
      const moduleId = str(args, "app", 60)?.trim() ?? "";
      const choice = parseAppAccessChoice((str(args, "access", 20) ?? "").toUpperCase());
      if (!choice) throw new ToolError("access must be allowed, blocked or plan.");
      const reason = reasonOf(args);
      try {
        await setOrganizationAppAccess({ organizationId: org.id, moduleId, choice, actorId: ctx.agent.userId, knownModuleIds: moduleRegistry.all().map((manifest) => manifest.id) });
      } catch (error) {
        throw new ToolError(error instanceof Error ? error.message : "Could not change app access.");
      }
      await auditAdmin(ctx, "org.app_access", "organization", org.id, { reason, app: moduleId, access: choice });
      return { data: { organization: org.slug, app: moduleId, access: choice.toLowerCase(), message: "Done. Its data is kept either way." }, targetType: "organization", targetId: org.id };
    },
  },
  {
    name: "add_organization_member",
    title: "Invite a person to an organization",
    description: "Invite a person (by email) to an organization with a role (role slug or name; default User). They sign in with a sign-in link or 'Forgot your password?'. Uses a seat. Needs a reason.",
    inputSchema: { type: "object", properties: { ...orgArgRequired, email: { type: "string" }, role: { type: "string" }, ...reasonArg }, required: ["organization", "email", "reason"], additionalProperties: false },
    readOnly: false,
    available: admin,
    run: async (ctx, args) => {
      const org = await findOrganization(str(args, "organization", 100));
      const email = str(args, "email", 200)?.trim() ?? "";
      if (isAgentEmail(email)) throw new ToolError("That is an agent address. Agents are added from AI Agents.");
      const roles = await platformTx((tx) => tx.role.findMany({ where: { organizationId: org.id }, select: { id: true, slug: true, name: true } }));
      const wanted = (str(args, "role", 60)?.trim() || "user").toLowerCase();
      const role = roles.find((item) => item.slug === wanted || item.name.toLowerCase() === wanted);
      if (!role) throw new ToolError(`No role "${wanted}" in ${org.name}. Roles: ${roles.map((item) => item.slug).join(", ")}.`);
      const reason = reasonOf(args);
      try {
        const added = await addOrganizationMember({ organizationId: org.id, email, roleId: role.id, actorId: ctx.agent.userId });
        await auditAdmin(ctx, "org.member_added", "user", added.userId, { reason, organization: org.slug, role: role.slug });
        return { data: { organization: org.slug, email: added.email, role: role.name, status: added.status.toLowerCase() }, targetType: "user", targetId: added.userId };
      } catch (error) {
        throw new ToolError(error instanceof Error ? error.message : "Could not add that person.");
      }
    },
  },
  {
    name: "run_job",
    title: "Run a background job now",
    description: "Start one scheduled background job now (see list_job_runs for names). Needs a reason.",
    inputSchema: { type: "object", properties: { job: { type: "string" }, ...reasonArg }, required: ["job", "reason"], additionalProperties: false },
    readOnly: false,
    available: admin,
    run: async (ctx, args) => {
      const job = str(args, "job", 100)?.trim() ?? "";
      const reason = reasonOf(args);
      const result = await runJobNow(job, ctx.agent.userId);
      if (!result.ok) throw new ToolError(result.reason ?? "Could not start it.");
      await auditAdmin(ctx, "job.run", "job", job, { reason });
      return { data: { job, message: "Started. Check list_job_runs for the result." }, targetType: "job", targetId: job };
    },
  },
];

