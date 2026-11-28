"use server";

import { defaultAgentName, isAgentEmail, isAgentPlatform, platformFromClientName } from "@pubcommand/core";
import { appendOrgAudit, createAgentMember, rawPrisma, tenantDb } from "@pubcommand/db";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { CONSOLE_ORG_SLUG } from "@/lib/console-workspace";
import { currentRequest } from "@/lib/request";
import { checkAuthorizeRequest, issueAuthorizationCode, oauthRedirect } from "./oauth";

/**
 * Sign-in on the app host (app.<root>/agents/connect): the one address for every organization,
 * used by the GrokBot plugin. The person picks which of their organizations the agent works in.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(formData: FormData, key: string, max = 300): string {
  return String(formData.get(key) ?? "").trim().slice(0, max);
}

function oauthParams(formData: FormData): Record<string, string | undefined> {
  const keys = ["client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "response_type"];
  return Object.fromEntries(keys.map((key) => [key, formData.get(key) === null ? undefined : String(formData.get(key)).slice(0, 2000)]));
}

async function signedInPerson() {
  const request = await currentRequest();
  if (request.site.kind !== "app") redirect("/");
  const auth = await readSession();
  if (!auth.user || isAgentEmail(auth.user.email)) redirect("/");
  return { userId: auth.user.id, request };
}

export async function approveAppConnection(formData: FormData) {
  const { userId, request } = await signedInPerson();
  const checked = await checkAuthorizeRequest(oauthParams(formData));
  if (!checked.ok) redirect("redirect" in checked ? checked.redirect : "/");
  const oauth = checked.request;
  const organizationId = text(formData, "organizationId", 40);
  const membership = UUID.test(organizationId)
    ? await rawPrisma().membership.findFirst({
        where: { organizationId, userId, status: "ACTIVE", organization: { deletedAt: null, suspendedAt: null, NOT: { slug: CONSOLE_ORG_SLUG } } },
        include: { user: { select: { name: true, email: true } } },
      })
    : null;
  if (!membership) redirect(`/agents/connect?${new URLSearchParams(Object.entries(oauthParams(formData)).filter((entry): entry is [string, string] => Boolean(entry[1]))).toString()}&error=${encodeURIComponent("Choose one of your organizations.")}`);
  const db = tenantDb(organizationId);
  let agentId = text(formData, "agentId", 40);
  if (agentId && agentId !== "new") {
    const agent = UUID.test(agentId) ? await db.aiAgent.findFirst({ where: { id: agentId, ownerUserId: userId, scope: "organization", removedAt: null } }) : null;
    if (!agent) redirect("/");
    await db.aiAgent.updateMany({ where: { id: agent.id }, data: { connection: "oauth" } });
  } else {
    const wanted = text(formData, "platform", 20);
    const platform = isAgentPlatform(wanted) ? wanted : platformFromClientName(oauth.clientName);
    agentId = (
      await createAgentMember({
        organizationId,
        ownerUserId: userId,
        name: text(formData, "name", 80) || defaultAgentName(membership.user.name, membership.user.email, platform),
        platform,
        connection: "oauth",
        actorId: userId,
      })
    ).agentId;
  }
  const code = await issueAuthorizationCode({ organizationId, agentId, request: oauth });
  await appendOrgAudit(organizationId, { actorId: userId, action: "agents.connection.approved", targetType: "ai_agent", targetId: agentId, metadata: { client: oauth.clientName, via: "app" } });
  redirect(oauthRedirect(oauth.redirectUri, { code, state: oauth.state, iss: request.origin }));
}

export async function denyAppConnection(formData: FormData) {
  await signedInPerson();
  const checked = await checkAuthorizeRequest(oauthParams(formData));
  if (!checked.ok) redirect("redirect" in checked ? checked.redirect : "/");
  redirect(oauthRedirect(checked.request.redirectUri, { error: "access_denied", error_description: "The PubCommand user declined.", state: checked.request.state }));
}
