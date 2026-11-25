"use server";

import { isAgentPlatform, platformFromClientName, defaultAgentName } from "@pubcommand/core";
import { appendPlatformAudit, createPlatformAgent, rawPrisma, removeAgentMember, tenantDb } from "@pubcommand/db";
import { redirect } from "next/navigation";
import { superAdminCtx } from "./platform-access";
import type { NewKeyState } from "./actions";
import { issueAgentToken } from "./data";
import { checkAuthorizeRequest, issueAuthorizationCode, oauthRedirect } from "./oauth";
import { restoreNotes } from "./platform-org-tools";

/**
 * Platform agents (admin console → AI Agents). Only an active SUPER_ADMIN with a ready session
 * (2FA when required) can add, change or connect one. Every change is in the platform audit log.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(formData: FormData, key: string, max = 300): string {
  return String(formData.get(key) ?? "").trim().slice(0, max);
}

function back(path: string, kind: "error" | "notice", message: string) {
  return `${path}?${kind}=${encodeURIComponent(message)}`;
}

async function requireSuperAdmin() {
  const ctx = await superAdminCtx();
  if (!ctx) redirect("/?error=Only super admins can manage platform AI agents.");
  return ctx;
}

async function platformAgent(consoleOrganizationId: string, agentId: string) {
  if (!UUID.test(agentId)) return null;
  return tenantDb(consoleOrganizationId).aiAgent.findFirst({ where: { id: agentId, scope: "platform", removedAt: null } });
}

export async function createPlatformAgentWithKey(_previous: NewKeyState, formData: FormData): Promise<NewKeyState> {
  const ctx = await superAdminCtx();
  if (!ctx) return { ok: false, error: "Only super admins can add platform agents." };
  const platform = text(formData, "platform", 20);
  if (!isAgentPlatform(platform)) return { ok: false, error: "Choose the AI platform." };
  const me = await rawPrisma().user.findUnique({ where: { id: ctx.userId }, select: { name: true, email: true } });
  const name = text(formData, "name", 80) || `${defaultAgentName(me?.name, ctx.email, platform)} (Platform)`;
  try {
    const created = await createPlatformAgent({
      consoleOrganizationId: ctx.consoleOrganizationId,
      ownerUserId: ctx.userId,
      name,
      platform,
      connection: "key",
      allowAdminActions: formData.get("allowAdminActions") === "on",
      actorId: ctx.userId,
    });
    const key = await issueAgentToken({ organizationId: ctx.consoleOrganizationId, agentId: created.agentId, kind: "key", createdById: ctx.userId });
    await appendPlatformAudit({ actorId: ctx.userId, action: "agents.platform_agent.key_created", targetType: "ai_agent", targetId: created.agentId });
    return { ok: true, key, name, agentId: created.agentId };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not add the agent." };
  }
}

export async function newPlatformAgentKey(_previous: NewKeyState, formData: FormData): Promise<NewKeyState> {
  const ctx = await superAdminCtx();
  if (!ctx) return { ok: false, error: "Only super admins can manage platform agents." };
  const agent = await platformAgent(ctx.consoleOrganizationId, text(formData, "agentId", 40));
  if (!agent) return { ok: false, error: "That agent no longer exists." };
  const key = await issueAgentToken({ organizationId: ctx.consoleOrganizationId, agentId: agent.id, kind: "key", createdById: ctx.userId });
  await appendPlatformAudit({ actorId: ctx.userId, action: "agents.platform_agent.key_created", targetType: "ai_agent", targetId: agent.id });
  return { ok: true, key, name: agent.name, agentId: agent.id };
}

export async function updatePlatformAgent(formData: FormData) {
  const ctx = await requireSuperAdmin();
  const agent = await platformAgent(ctx.consoleOrganizationId, text(formData, "agentId", 40));
  if (!agent) redirect(back("/agents", "error", "That agent no longer exists."));
  const path = `/agents/${agent.id}`;
  const intent = text(formData, "intent", 20);
  const db = tenantDb(ctx.consoleOrganizationId);
  if (intent === "pause" || intent === "resume") {
    await db.aiAgent.updateMany({ where: { id: agent.id }, data: { pausedAt: intent === "pause" ? new Date() : null } });
    await appendPlatformAudit({ actorId: ctx.userId, action: `agents.platform_agent.${intent === "pause" ? "paused" : "resumed"}`, targetType: "ai_agent", targetId: agent.id });
    redirect(back(path, "notice", intent === "pause" ? "Paused." : "Resumed."));
  }
  if (intent === "revoke") {
    const tokenId = text(formData, "tokenId", 40);
    const clientId = text(formData, "clientId", 80);
    const result = await db.aiAgentToken.updateMany({
      where: clientId ? { agentId: agent.id, clientId, revokedAt: null } : { agentId: agent.id, id: UUID.test(tokenId) ? tokenId : "00000000-0000-0000-0000-000000000000", revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await appendPlatformAudit({ actorId: ctx.userId, action: "agents.platform_agent.token_revoked", targetType: "ai_agent", targetId: agent.id, metadata: { count: result.count } });
    redirect(back(path, "notice", clientId ? "Disconnected." : "Key revoked."));
  }
  if (intent === "remove") {
    if (text(formData, "confirm", 100) !== agent.name) redirect(back(path, "error", "Type the agent's name exactly to remove it."));
    await removeAgentMember({ organizationId: ctx.consoleOrganizationId, agentId: agent.id, actorId: ctx.userId });
    await appendPlatformAudit({ actorId: ctx.userId, action: "agents.platform_agent.removed", targetType: "ai_agent", targetId: agent.id });
    redirect(back("/agents", "notice", `${agent.name} removed.`));
  }
  const name = text(formData, "name", 80).replace(/\s+/g, " ");
  const platform = text(formData, "platform", 20);
  if (!name || !isAgentPlatform(platform)) redirect(back(path, "error", "Give it a name and a platform."));
  const allowAdminActions = formData.get("allowAdminActions") === "on";
  await db.aiAgent.updateMany({ where: { id: agent.id }, data: { name, platform, allowAdminActions } });
  await rawPrisma().user.update({ where: { id: agent.userId }, data: { name } });
  await appendPlatformAudit({ actorId: ctx.userId, action: "agents.platform_agent.updated", targetType: "ai_agent", targetId: agent.id, metadata: { name, platform, allowAdminActions } });
  redirect(back(path, "notice", "Saved."));
}

// ── OAuth consent on the admin host ─────────────────────────────────────────

function oauthParams(formData: FormData): Record<string, string | undefined> {
  const keys = ["client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "response_type"];
  return Object.fromEntries(keys.map((key) => [key, formData.get(key) === null ? undefined : String(formData.get(key)).slice(0, 2000)]));
}

export async function approvePlatformConnection(formData: FormData) {
  const ctx = await requireSuperAdmin();
  const checked = await checkAuthorizeRequest(oauthParams(formData));
  if (!checked.ok) redirect("redirect" in checked ? checked.redirect : back("/agents", "error", checked.show));
  const { request } = checked;
  const db = tenantDb(ctx.consoleOrganizationId);
  let agentId = text(formData, "agentId", 40);
  if (agentId && agentId !== "new") {
    const agent = UUID.test(agentId) ? await db.aiAgent.findFirst({ where: { id: agentId, scope: "platform", ownerUserId: ctx.userId, removedAt: null } }) : null;
    if (!agent) redirect(back("/agents", "error", "That agent is not yours or was removed."));
    await db.aiAgent.updateMany({ where: { id: agent.id }, data: { connection: "oauth" } });
  } else {
    const wanted = text(formData, "platform", 20);
    const platform = isAgentPlatform(wanted) ? wanted : platformFromClientName(request.clientName);
    const me = await rawPrisma().user.findUnique({ where: { id: ctx.userId }, select: { name: true } });
    try {
      agentId = (
        await createPlatformAgent({
          consoleOrganizationId: ctx.consoleOrganizationId,
          ownerUserId: ctx.userId,
          name: text(formData, "name", 80) || `${defaultAgentName(me?.name, ctx.email, platform)} (Platform)`,
          platform,
          connection: "oauth",
          allowAdminActions: formData.get("allowAdminActions") === "on",
          actorId: ctx.userId,
        })
      ).agentId;
    } catch (error) {
      redirect(back("/agents", "error", error instanceof Error ? error.message : "Could not add the agent."));
    }
  }
  const code = await issueAuthorizationCode({ organizationId: ctx.consoleOrganizationId, agentId, request });
  await appendPlatformAudit({ actorId: ctx.userId, action: "agents.platform_agent.connected", targetType: "ai_agent", targetId: agentId, metadata: { client: request.clientName } });
  redirect(oauthRedirect(request.redirectUri, { code, state: request.state, iss: ctx.request.origin }));
}

export async function denyPlatformConnection(formData: FormData) {
  await requireSuperAdmin();
  const checked = await checkAuthorizeRequest(oauthParams(formData));
  if (!checked.ok) redirect("redirect" in checked ? checked.redirect : "/agents");
  redirect(oauthRedirect(checked.request.redirectUri, { error: "access_denied", error_description: "The PubCommand staff member declined.", state: checked.request.state }));
}

/** Admin console → AI Agents → "Notes deleted by AI agents": restore one delete batch. */
export async function restoreAgentDeletedNotes(formData: FormData) {
  const ctx = await requireSuperAdmin();
  const auditId = text(formData, "auditId", 40);
  const row = UUID.test(auditId) ? await rawPrisma().platformAuditLog.findFirst({ where: { id: auditId, action: "agents.notes.deleted" } }) : null;
  const meta = (row?.metadata ?? {}) as { kind?: string; organizationId?: string | null; noteIds?: unknown };
  const noteIds = Array.isArray(meta.noteIds) ? meta.noteIds.filter((id): id is string => typeof id === "string" && UUID.test(id)) : [];
  if (!row || (meta.kind !== "brain" && meta.kind !== "master") || noteIds.length === 0) redirect(back("/agents", "error", "That delete batch was not found."));
  const restored = await restoreNotes({ kind: meta.kind, organizationId: meta.organizationId ?? null, noteIds });
  await appendPlatformAudit({ actorId: ctx.userId, action: "agents.notes.restored_by_staff", targetType: row.targetType, targetId: row.targetId, metadata: { batch: row.id, restored } });
  redirect(back("/agents", "notice", `Restored ${restored} note${restored === 1 ? "" : "s"}.`));
}
