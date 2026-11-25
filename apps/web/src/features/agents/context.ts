import { can, type AccessScope, type AccessSubject } from "@pubcommand/core";
import { loadAccessSubject, loadSuperAdminSubject, rawPrisma, resolveOrgBySlug, tenantDb } from "@pubcommand/db";
import { moduleRegistry } from "@pubcommand/modules";
import { CONSOLE_ORG_SLUG, ensureConsoleOrganization } from "@/lib/console-workspace";
import { currentRequest } from "@/lib/request";
import { RATE_WINDOW_MS, bearerToken, hashToken, rateAllowed, tokenKind } from "./tokens";

/**
 * The organization an agent works in comes from the host it calls (acme.pubcommand.com/api/mcp),
 * and its token must belong to that same organization: a token of another organization is
 * simply not found. Every read and write then goes through tenantDb(organizationId), and every
 * permission check through the agent's own membership (its role, per-app access, exclusions).
 *
 * Platform agents (scope "platform") call the admin console host instead (admin.<root>/api/mcp).
 * They belong to a SUPER_ADMIN, are stored under the console organization, and get the console
 * workspace's apps with full access plus the platform tools (features/agents/platform-tools.ts).
 */
export type AgentContext = {
  /** "platform": a super admin's agent on the admin host. */
  scope: "organization" | "platform";
  /** Platform agents: may make admin changes. */
  allowAdminActions: boolean;
  organization: { id: string; slug: string; name: string };
  origin: string;
  host: string;
  agent: { id: string; name: string; platform: string; userId: string; ownerUserId: string };
  tokenId: string;
  subject: AccessSubject;
  brands: { id: string; name: string; slug: string }[];
};

export type AgentAuthFailure = { ok: false; status: 401 | 403 | 404 | 429; error: string; agentId?: string; organizationId?: string };

/**
 * The organization this host serves (org hosts and custom domains), or null. On the admin
 * console host it is the console organization, which holds the platform agents.
 */
export async function hostOrganization() {
  const request = await currentRequest();
  if (request.site.kind === "admin") {
    await ensureConsoleOrganization();
    const resolved = await resolveOrgBySlug(CONSOLE_ORG_SLUG);
    return resolved && !resolved.redirected ? { resolved, request, platform: true as const } : null;
  }
  if (request.site.kind !== "org") return null;
  const resolved = await resolveOrgBySlug(request.site.slug);
  if (!resolved || resolved.redirected) return null;
  return { resolved, request, platform: false as const };
}

/** A platform agent's owner must still be an active SUPER_ADMIN. */
async function ownerIsSuperAdmin(userId: string): Promise<boolean> {
  const staff = await rawPrisma().platformStaff.findUnique({ where: { userId }, include: { user: { select: { disabledAt: true, deletedAt: true } } } });
  return Boolean(staff && !staff.disabledAt && staff.role === "SUPER_ADMIN" && !staff.user.disabledAt && !staff.user.deletedAt);
}

export async function authenticateAgent(request: Request): Promise<{ ok: true; ctx: AgentContext } | AgentAuthFailure> {
  const host = await hostOrganization();
  if (!host) return { ok: false, status: 404, error: "Not found." };
  const { resolved } = host;
  if (resolved.suspendedAt) return { ok: false, status: 403, error: "This organization is suspended." };
  const presented = bearerToken(request.headers);
  const kind = presented ? tokenKind(presented) : null;
  if (!presented || (kind !== "key" && kind !== "access")) return { ok: false, status: 401, error: "Sign in to PubCommand: connect this agent from AI Agents, or send its API key as Authorization: Bearer pca_…" };
  const db = tenantDb(resolved.id);
  const token = await db.aiAgentToken.findFirst({ where: { tokenHash: hashToken(presented) } });
  if (!token || token.revokedAt || token.kind !== kind || (token.expiresAt && token.expiresAt <= new Date())) {
    return { ok: false, status: 401, error: "That token is not valid, expired, or was revoked." };
  }
  const agent = await db.aiAgent.findFirst({ where: { id: token.agentId } });
  if (!agent || agent.removedAt) return { ok: false, status: 401, error: "This agent was removed." };
  // A platform agent works only on the admin host, an organization agent only on its organization's.
  if ((agent.scope === "platform") !== host.platform) return { ok: false, status: 401, error: "That token is not valid, expired, or was revoked." };
  if (agent.pausedAt) return { ok: false, status: 403, error: "This agent is paused. Ask an admin to resume it in AI Agents.", agentId: agent.id, organizationId: resolved.id };
  const user = await rawPrisma().user.findUnique({ where: { id: agent.userId }, select: { disabledAt: true, deletedAt: true } });
  if (!user || user.disabledAt || user.deletedAt) return { ok: false, status: 401, error: "This agent's account is turned off." };
  // The owner must still have their access: an agent never outlives its person's.
  if (host.platform) {
    if (!(await ownerIsSuperAdmin(agent.ownerUserId))) return { ok: false, status: 403, error: "This agent's owner is no longer an active super admin.", agentId: agent.id, organizationId: resolved.id };
  } else {
    const owner = await db.membership.findFirst({ where: { userId: agent.ownerUserId, status: "ACTIVE" }, select: { id: true } });
    if (!owner) return { ok: false, status: 403, error: "This agent's owner is no longer an active member.", agentId: agent.id, organizationId: resolved.id };
  }
  // Platform agents get the console workspace with every permission, like super admins in the console.
  const subject = host.platform
    ? await loadSuperAdminSubject(resolved.id, agent.userId, moduleRegistry.permissionModules())
    : await loadAccessSubject(resolved.id, agent.userId, moduleRegistry.permissionModules());
  if (!subject) return { ok: false, status: 403, error: "This agent is not an active member of the organization.", agentId: agent.id, organizationId: resolved.id };
  const recent = await db.aiAgentCall.count({ where: { agentId: agent.id, createdAt: { gte: new Date(Date.now() - RATE_WINDOW_MS) }, status: { not: "rate_limited" } } });
  if (!rateAllowed(recent)) return { ok: false, status: 429, error: "Too many requests. Slow down and try again in a minute.", agentId: agent.id, organizationId: resolved.id };
  const brands = await db.brand.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, slug: true } });
  const now = new Date();
  await db.aiAgentToken.updateMany({ where: { id: token.id }, data: { lastUsedAt: now } });
  await db.aiAgent.updateMany({ where: { id: agent.id }, data: { lastActiveAt: now } });
  return {
    ok: true,
    ctx: {
      scope: host.platform ? "platform" : "organization",
      allowAdminActions: host.platform && agent.allowAdminActions,
      organization: { id: resolved.id, slug: resolved.slug, name: resolved.name },
      origin: host.request.origin,
      host: host.request.host,
      agent: { id: agent.id, name: agent.name, platform: agent.platform, userId: agent.userId, ownerUserId: agent.ownerUserId },
      tokenId: token.id,
      subject,
      brands: subject.membershipBrandId ? brands.filter((brand) => brand.id === subject.membershipBrandId) : brands,
    },
  };
}

/** The brand a tool works in: the one named (id, slug or name), else the agent's only/first brand. */
export function pickBrand(ctx: AgentContext, wanted: unknown): { id: string; name: string; slug: string } | null {
  if (typeof wanted === "string" && wanted.trim()) {
    const w = wanted.trim().toLowerCase();
    return ctx.brands.find((brand) => brand.id === w || brand.slug.toLowerCase() === w || brand.name.toLowerCase() === w) ?? null;
  }
  return ctx.brands[0] ?? null;
}

export function scopeFor(ctx: AgentContext, brandId: string | null): AccessScope {
  return { organizationId: ctx.organization.id, brandId: ctx.subject.membershipBrandId ?? brandId };
}

export function agentCan(ctx: AgentContext, permission: string, brandId: string | null): boolean {
  return can(ctx.subject, permission, scopeFor(ctx, brandId));
}

export async function logAgentCall(entry: {
  organizationId: string;
  agentId: string;
  tool: string;
  status: "ok" | "error" | "denied" | "rate_limited";
  targetType?: string | null;
  targetId?: string | null;
  message?: string | null;
  durationMs: number;
}): Promise<void> {
  try {
    await tenantDb(entry.organizationId).aiAgentCall.create({
      data: {
        organizationId: entry.organizationId,
        agentId: entry.agentId,
        tool: entry.tool.slice(0, 80),
        status: entry.status,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        message: entry.message ? entry.message.slice(0, 500) : null,
        durationMs: Math.max(0, Math.round(entry.durationMs)),
      },
    });
  } catch (error) {
    console.error("[agents] call log failed", error);
  }
}
