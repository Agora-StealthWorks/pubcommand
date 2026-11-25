import { agentEmail, isAgentEmail, isAgentPlatform, type AgentPlatform } from "@pubcommand/core";
import { randomUUID } from "node:crypto";
import { rawPrisma } from "./client";

/**
 * AI Agents. An agent is a member of exactly one organization: its own user row (reserved
 * email domain, no password), an ACTIVE membership with a role, and an ai_agents row naming
 * its owner and platform. Roles, per-app access and exclusions apply to it like to a person.
 * Agents never take a seat (see occupyingSeats in provision.ts).
 */

export type CreatedAgent = { agentId: string; userId: string; roleId: string };

/**
 * Add an agent for `ownerUserId`, an active (human) member of the organization. The agent
 * starts with its owner's role (full access as that person) unless `roleId` names another
 * role of the organization; admins narrow it afterwards in AI Agents or Settings → Users.
 */
export async function createAgentMember(input: {
  organizationId: string;
  ownerUserId: string;
  name: string;
  platform: AgentPlatform;
  connection: "oauth" | "key";
  roleId?: string | null;
  actorId: string;
}): Promise<CreatedAgent> {
  if (!isAgentPlatform(input.platform)) throw new Error("Choose the agent's AI platform.");
  const name = input.name.trim().replace(/\s+/g, " ").slice(0, 80);
  if (!name) throw new Error("Give the agent a name.");
  return rawPrisma().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_org_id', ${input.organizationId}, true)`;
    const owner = await tx.membership.findUnique({
      where: { organizationId_userId: { organizationId: input.organizationId, userId: input.ownerUserId } },
      include: { user: true },
    });
    if (!owner || owner.status !== "ACTIVE" || owner.user.disabledAt || owner.user.deletedAt) throw new Error("The agent's owner must be an active member of this organization.");
    if (isAgentEmail(owner.user.email)) throw new Error("An agent cannot own another agent.");
    let roleId = owner.roleId;
    if (input.roleId) {
      const role = await tx.role.findFirst({ where: { id: input.roleId, organizationId: input.organizationId } });
      if (!role) throw new Error("Choose a role of this organization.");
      roleId = role.id;
    }
    const agentId = randomUUID();
    const user = await tx.user.create({ data: { email: agentEmail(agentId), name, passwordHash: null } });
    await tx.membership.create({ data: { organizationId: input.organizationId, userId: user.id, roleId, status: "ACTIVE" } });
    await tx.aiAgent.create({
      data: {
        id: agentId,
        organizationId: input.organizationId,
        userId: user.id,
        ownerUserId: input.ownerUserId,
        name,
        platform: input.platform,
        connection: input.connection,
        createdById: input.actorId,
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: "agents.agent.created",
        targetType: "ai_agent",
        targetId: agentId,
        metadata: { name, platform: input.platform, owner: input.ownerUserId, connection: input.connection },
      },
    });
    return { agentId, userId: user.id, roleId };
  });
}

/** Remove an agent: its membership is disabled and every token revoked. Its posts keep their author. */
export async function removeAgentMember(input: { organizationId: string; agentId: string; actorId: string }): Promise<void> {
  await rawPrisma().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_org_id', ${input.organizationId}, true)`;
    const agent = await tx.aiAgent.findFirst({ where: { id: input.agentId, organizationId: input.organizationId } });
    if (!agent || agent.removedAt) throw new Error("That agent no longer exists.");
    const now = new Date();
    await tx.aiAgent.update({ where: { id: agent.id }, data: { removedAt: now } });
    await tx.aiAgentToken.updateMany({ where: { agentId: agent.id, revokedAt: null }, data: { revokedAt: now } });
    await tx.membership.updateMany({ where: { organizationId: input.organizationId, userId: agent.userId }, data: { status: "DISABLED" } });
    await tx.auditLog.create({
      data: { organizationId: input.organizationId, actorId: input.actorId, action: "agents.agent.removed", targetType: "ai_agent", targetId: agent.id, metadata: { name: agent.name } },
    });
  });
}
