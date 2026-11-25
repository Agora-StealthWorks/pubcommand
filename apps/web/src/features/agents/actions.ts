"use server";

import { can, defaultAgentName, isAgentEmail, isAgentPlatform, platformFromClientName } from "@pubcommand/core";
import { appendOrgAudit, createAgentMember, rawPrisma, removeAgentMember, tenantDb } from "@pubcommand/db";
import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/org";
import { currentRequest } from "@/lib/request";
import { issueAgentToken, setAllowPublishing } from "./data";
import { checkAuthorizeRequest, issueAuthorizationCode, oauthRedirect } from "./oauth";
import { PostError, approveTextPost, approveWebPost, rejectPendingPost } from "./posts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(formData: FormData, key: string, max = 300): string {
  return String(formData.get(key) ?? "").trim().slice(0, max);
}

function withMessage(path: string, kind: "error" | "notice", message: string): string {
  const [base, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  params.set(kind, message);
  return `${base}?${params.toString()}`;
}

/** Signed-in person in this organization. canManage = agents.manage (every agent, approvals, the setting). */
async function agentsCtx() {
  const request = await currentRequest();
  if (request.site.kind !== "org") redirect("/");
  const ctx = await getOrgContext(request.site.slug);
  if (ctx.kind !== "ok") redirect("/");
  return { ...ctx, actorId: ctx.auth.user.id, canManage: can(ctx.subject, "agents.manage", ctx.scope) };
}

type Ctx = Awaited<ReturnType<typeof agentsCtx>>;

/** An agent this person may manage: their own, or any with agents.manage. */
async function manageableAgent(ctx: Ctx, agentId: string) {
  const agent = UUID.test(agentId) ? await tenantDb(ctx.resolved.id).aiAgent.findFirst({ where: { id: agentId, removedAt: null } }) : null;
  if (!agent || (!ctx.canManage && agent.ownerUserId !== ctx.actorId)) return null;
  return agent;
}

export type NewKeyState = { ok: true; key: string; name: string; agentId: string } | { ok: false; error: string } | null;

/** Add an agent that connects with an API key (Grok, OpenAI or Claude API, scripts). The key is returned once. */
export async function createAgentWithKey(_previous: NewKeyState, formData: FormData): Promise<NewKeyState> {
  const ctx = await agentsCtx();
  const platform = text(formData, "platform", 20);
  if (!isAgentPlatform(platform)) return { ok: false, error: "Choose the AI platform." };
  const ownerUserId = ctx.canManage && UUID.test(text(formData, "ownerUserId", 40)) ? text(formData, "ownerUserId", 40) : ctx.actorId;
  const owner = await rawPrisma().user.findUnique({ where: { id: ownerUserId }, select: { name: true, email: true } });
  if (!owner || isAgentEmail(owner.email)) return { ok: false, error: "Choose a person as the owner." };
  const name = text(formData, "name", 80) || defaultAgentName(owner.name, owner.email, platform);
  const roleId = ctx.canManage && UUID.test(text(formData, "roleId", 40)) ? text(formData, "roleId", 40) : null;
  try {
    const created = await createAgentMember({ organizationId: ctx.resolved.id, ownerUserId, name, platform, connection: "key", roleId, actorId: ctx.actorId });
    const key = await issueAgentToken({ organizationId: ctx.resolved.id, agentId: created.agentId, kind: "key", createdById: ctx.actorId });
    await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "agents.key.created", targetType: "ai_agent", targetId: created.agentId });
    return { ok: true, key, name, agentId: created.agentId };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not add the agent." };
  }
}

/** A new API key for an existing agent (its other keys keep working until revoked). */
export async function newAgentKey(_previous: NewKeyState, formData: FormData): Promise<NewKeyState> {
  const ctx = await agentsCtx();
  const agent = await manageableAgent(ctx, text(formData, "agentId", 40));
  if (!agent) return { ok: false, error: "You cannot manage that agent." };
  const key = await issueAgentToken({ organizationId: ctx.resolved.id, agentId: agent.id, kind: "key", createdById: ctx.actorId });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "agents.key.created", targetType: "ai_agent", targetId: agent.id });
  return { ok: true, key, name: agent.name, agentId: agent.id };
}

export async function revokeAgentToken(formData: FormData) {
  const ctx = await agentsCtx();
  const agentId = text(formData, "agentId", 40);
  const back = `/agents/${agentId}`;
  const agent = await manageableAgent(ctx, agentId);
  if (!agent) redirect(withMessage("/agents", "error", "You cannot manage that agent."));
  const db = tenantDb(ctx.resolved.id);
  const tokenId = text(formData, "tokenId", 40);
  const clientId = text(formData, "clientId", 80);
  const where = clientId ? { agentId: agent.id, clientId, revokedAt: null } : { agentId: agent.id, id: UUID.test(tokenId) ? tokenId : "00000000-0000-0000-0000-000000000000", revokedAt: null };
  const result = await db.aiAgentToken.updateMany({ where, data: { revokedAt: new Date() } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: clientId ? "agents.connection.revoked" : "agents.key.revoked", targetType: "ai_agent", targetId: agent.id, metadata: { count: result.count } });
  redirect(withMessage(back, "notice", clientId ? "Disconnected. The app must sign in again." : "Key revoked."));
}

export async function setAgentPaused(formData: FormData) {
  const ctx = await agentsCtx();
  const agent = await manageableAgent(ctx, text(formData, "agentId", 40));
  if (!agent) redirect(withMessage("/agents", "error", "You cannot manage that agent."));
  const paused = text(formData, "paused", 5) === "1";
  await tenantDb(ctx.resolved.id).aiAgent.updateMany({ where: { id: agent.id }, data: { pausedAt: paused ? new Date() : null } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: paused ? "agents.agent.paused" : "agents.agent.resumed", targetType: "ai_agent", targetId: agent.id });
  redirect(withMessage(`/agents/${agent.id}`, "notice", paused ? "Paused. It cannot do anything until resumed." : "Resumed."));
}

export async function updateAgent(formData: FormData) {
  const ctx = await agentsCtx();
  const agent = await manageableAgent(ctx, text(formData, "agentId", 40));
  if (!agent) redirect(withMessage("/agents", "error", "You cannot manage that agent."));
  const name = text(formData, "name", 80).replace(/\s+/g, " ");
  const platform = text(formData, "platform", 20);
  if (!name || !isAgentPlatform(platform)) redirect(withMessage(`/agents/${agent.id}`, "error", "Give it a name and a platform."));
  await tenantDb(ctx.resolved.id).aiAgent.updateMany({ where: { id: agent.id }, data: { name, platform } });
  await rawPrisma().user.update({ where: { id: agent.userId }, data: { name } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "agents.agent.updated", targetType: "ai_agent", targetId: agent.id, metadata: { name, platform } });
  redirect(withMessage(`/agents/${agent.id}`, "notice", "Saved."));
}

export async function removeAgent(formData: FormData) {
  const ctx = await agentsCtx();
  const agent = await manageableAgent(ctx, text(formData, "agentId", 40));
  if (!agent) redirect(withMessage("/agents", "error", "You cannot manage that agent."));
  if (text(formData, "confirm", 100) !== agent.name) redirect(withMessage(`/agents/${agent.id}`, "error", "Type the agent's name exactly to remove it."));
  await removeAgentMember({ organizationId: ctx.resolved.id, agentId: agent.id, actorId: ctx.actorId });
  redirect(withMessage("/agents", "notice", `${agent.name} removed. Its posts stay.`));
}

export async function saveAgentSettings(formData: FormData) {
  const ctx = await agentsCtx();
  if (!ctx.canManage) redirect(withMessage("/agents/settings", "error", "Only admins with AI agent management can change this."));
  const allow = text(formData, "allowPublishing", 5) === "on";
  await setAllowPublishing(ctx.resolved.id, allow, ctx.actorId);
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "agents.settings.saved", targetType: "ai_agent_settings", metadata: { allowPublishing: allow } });
  redirect(withMessage("/agents/settings", "notice", allow ? "AI agents with publish rights now publish directly." : "AI agent posts now wait for approval."));
}

// ── Approvals ───────────────────────────────────────────────────────────────

export async function decidePendingPost(formData: FormData) {
  const ctx = await agentsCtx();
  const back = "/agents/approvals";
  const kind = text(formData, "kind", 10) === "text" ? "text" : "web";
  const postId = text(formData, "postId", 40);
  const decision = text(formData, "decision", 10);
  if (!UUID.test(postId)) redirect(back);
  const db = tenantDb(ctx.resolved.id);
  const post = kind === "web" ? await db.webPost.findFirst({ where: { id: postId } }) : await db.textPost.findFirst({ where: { id: postId } });
  const site = post ? (kind === "web" ? await db.webSite.findFirst({ where: { id: post.siteId } }) : await db.textSite.findFirst({ where: { id: post.siteId } })) : null;
  if (!post || !site) redirect(withMessage(back, "error", "That post no longer exists."));
  const permission = kind === "web" ? "websites.publish" : "miniblog.publish";
  if (!can(ctx.subject, permission, { organizationId: ctx.resolved.id, brandId: site.brandId })) redirect(withMessage(back, "error", "You need publish rights in that app to decide on this post."));
  try {
    if (decision === "approve") {
      const status =
        kind === "web"
          ? await approveWebPost({ organizationId: ctx.resolved.id, postId, actorId: ctx.actorId })
          : await approveTextPost({ organizationId: ctx.resolved.id, orgSlug: ctx.resolved.slug, host: ctx.request.host, postId, actorId: ctx.actorId, editorialEntitled: ctx.subject.entitledModuleIds.includes("editorial") });
      redirect(withMessage(back, "notice", status === "scheduled" ? "Approved and scheduled." : "Approved and published."));
    }
    await rejectPendingPost({ organizationId: ctx.resolved.id, kind, postId, actorId: ctx.actorId, note: text(formData, "note", 500) });
  } catch (error) {
    if (error instanceof PostError) redirect(withMessage(back, "error", error.message));
    throw error;
  }
  redirect(withMessage(back, "notice", "Sent back to draft."));
}

// ── OAuth consent (/agents/connect) ─────────────────────────────────────────

function oauthParams(formData: FormData): Record<string, string | undefined> {
  const keys = ["client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "response_type"];
  return Object.fromEntries(keys.map((key) => [key, formData.get(key) === null ? undefined : String(formData.get(key)).slice(0, 2000)]));
}

/** The person approved: create (or reuse) their agent, then send the connector a one-time code. */
export async function approveConnection(formData: FormData) {
  const ctx = await agentsCtx();
  const checked = await checkAuthorizeRequest(oauthParams(formData));
  if (!checked.ok) redirect("redirect" in checked ? checked.redirect : withMessage("/agents", "error", checked.show));
  const { request } = checked;
  const me = await rawPrisma().user.findUnique({ where: { id: ctx.actorId }, select: { name: true, email: true } });
  if (!me || isAgentEmail(me.email)) redirect("/agents");
  let agentId = text(formData, "agentId", 40);
  if (agentId && agentId !== "new") {
    const agent = UUID.test(agentId) ? await tenantDb(ctx.resolved.id).aiAgent.findFirst({ where: { id: agentId, ownerUserId: ctx.actorId, removedAt: null } }) : null;
    if (!agent) redirect(withMessage("/agents", "error", "That agent is not yours or was removed."));
    await tenantDb(ctx.resolved.id).aiAgent.updateMany({ where: { id: agent.id }, data: { connection: "oauth" } });
  } else {
    const wanted = text(formData, "platform", 20);
    const platform = isAgentPlatform(wanted) ? wanted : platformFromClientName(request.clientName);
    const name = text(formData, "name", 80) || defaultAgentName(me.name, me.email, platform);
    try {
      agentId = (await createAgentMember({ organizationId: ctx.resolved.id, ownerUserId: ctx.actorId, name, platform, connection: "oauth", actorId: ctx.actorId })).agentId;
    } catch (error) {
      redirect(withMessage("/agents", "error", error instanceof Error ? error.message : "Could not add the agent."));
    }
  }
  const code = await issueAuthorizationCode({ organizationId: ctx.resolved.id, agentId, request });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "agents.connection.approved", targetType: "ai_agent", targetId: agentId, metadata: { client: request.clientName } });
  redirect(oauthRedirect(request.redirectUri, { code, state: request.state, iss: ctx.request.origin }));
}

export async function denyConnection(formData: FormData) {
  await agentsCtx();
  const checked = await checkAuthorizeRequest(oauthParams(formData));
  if (!checked.ok) redirect("redirect" in checked ? checked.redirect : "/agents");
  redirect(oauthRedirect(checked.request.redirectUri, { error: "access_denied", error_description: "The PubCommand user declined.", state: checked.request.state }));
}
