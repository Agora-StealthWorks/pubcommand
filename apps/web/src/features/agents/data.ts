import { agentPlatformLabel } from "@pubcommand/core";
import { rawPrisma, tenantDb } from "@pubcommand/db";
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS, generateToken, type TokenKind } from "./tokens";

/** "Allow publishing by AI agents". Defaults to on (agents publish like people). */
export async function agentSettings(organizationId: string): Promise<{ allowPublishing: boolean }> {
  const row = await tenantDb(organizationId).aiAgentSettings.findFirst();
  return { allowPublishing: row?.allowPublishing ?? true };
}

export async function setAllowPublishing(organizationId: string, allowPublishing: boolean, actorId: string): Promise<void> {
  const db = tenantDb(organizationId);
  const updated = await db.aiAgentSettings.updateMany({ where: {}, data: { allowPublishing, updatedById: actorId } });
  if (updated.count === 0) await db.aiAgentSettings.create({ data: { organizationId, allowPublishing, updatedById: actorId } });
}

export type AgentLabel = { agentId: string; name: string; platform: string; platformLabel: string; ownerName: string };

/**
 * Internal labels for agent users of an organization, keyed by user id: used to mark agent
 * activity in lists ("AI · Claude · Stephen's"). Never used on public pages.
 */
export async function agentLabels(organizationId: string): Promise<Map<string, AgentLabel>> {
  const agents = await tenantDb(organizationId).aiAgent.findMany({ select: { id: true, userId: true, name: true, platform: true, ownerUserId: true } });
  if (agents.length === 0) return new Map();
  const owners = await rawPrisma().user.findMany({ where: { id: { in: [...new Set(agents.map((agent) => agent.ownerUserId))] } }, select: { id: true, name: true, email: true } });
  const ownerName = new Map(owners.map((owner) => [owner.id, owner.name || owner.email]));
  return new Map(
    agents.map((agent) => [
      agent.userId,
      { agentId: agent.id, name: agent.name, platform: agent.platform, platformLabel: agentPlatformLabel(agent.platform), ownerName: ownerName.get(agent.ownerUserId) ?? "Unknown" },
    ]),
  );
}

/** Make a token for an agent. Returns the plain token (shown or sent once). */
export async function issueAgentToken(input: { organizationId: string; agentId: string; kind: TokenKind; clientId?: string | null; createdById?: string | null }) {
  const made = generateToken(input.kind);
  const ttl = input.kind === "access" ? ACCESS_TOKEN_TTL_SECONDS : input.kind === "refresh" ? REFRESH_TOKEN_TTL_SECONDS : null;
  await tenantDb(input.organizationId).aiAgentToken.create({
    data: {
      organizationId: input.organizationId,
      agentId: input.agentId,
      kind: input.kind,
      prefix: made.prefix,
      tokenHash: made.hash,
      clientId: input.clientId ?? null,
      expiresAt: ttl ? new Date(Date.now() + ttl * 1000) : null,
      createdById: input.createdById ?? null,
    },
  });
  return made.token;
}
