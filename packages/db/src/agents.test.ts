import { randomBytes } from "node:crypto";
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { isAgentEmail } from "@pubcommand/core";
import { createAgentMember, removeAgentMember } from "./agents";
import { activateInvitedMemberships, addOrganizationMember, provisionOrganization } from "./provision";
import { tenantDb } from "./tenant";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/pubcommand";
process.env.DATABASE_URL = databaseUrl;

describe("AI agent members", () => {
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const suffix = randomBytes(4).toString("hex");
  const ownerEmail = `agent-owner-${suffix}@example.com`;
  const actorEmail = `agent-staff-${suffix}@example.com`;
  const otherEmail = `agent-other-${suffix}@example.com`;
  let actorId = "";
  let ownerId = "";
  let planId = "";
  const orgIds: string[] = [];

  beforeAll(async () => {
    execSync("pnpm exec prisma migrate deploy --schema prisma/schema", { cwd: new URL("..", import.meta.url).pathname, env: process.env, stdio: "inherit" });
    actorId = (await db.user.create({ data: { email: actorEmail, passwordHash: null } })).id;
    // One seat: the owner fills it, so only agents can be added.
    planId = (await db.plan.create({ data: { key: `agents-${suffix}`, name: "Solo", seatLimit: 1, monthlyPriceCents: 0 } })).id;
    for (const slug of [`agents-${suffix}`, `agents-b-${suffix}`]) {
      const created = await provisionOrganization({ name: "Agent Desk", slug, planId, adminEmail: slug === `agents-${suffix}` ? ownerEmail : otherEmail, actorId, actorEmail, permissionKeys: ["settings.manage"] });
      orgIds.push(created.organizationId);
    }
    ownerId = (await db.user.findUniqueOrThrow({ where: { email: ownerEmail } })).id;
    await activateInvitedMemberships(ownerId);
  });

  afterAll(async () => {
    const agentUsers = await db.aiAgent.findMany({ where: { organizationId: { in: orgIds } }, select: { userId: true } });
    await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    await db.user.deleteMany({ where: { OR: [{ email: { in: [ownerEmail, actorEmail, otherEmail] } }, { id: { in: agentUsers.map((row) => row.userId) } }] } });
    await db.plan.deleteMany({ where: { id: planId } });
    await db.$disconnect();
  });

  it("adds an agent with its owner's role, without taking a seat", async () => {
    const [organizationId] = orgIds as [string];
    const ownerMembership = await db.membership.findFirstOrThrow({ where: { organizationId, userId: ownerId } });
    const created = await createAgentMember({ organizationId, ownerUserId: ownerId, name: "  Desk   Claude ", platform: "claude", connection: "oauth", actorId: ownerId });
    const user = await db.user.findUniqueOrThrow({ where: { id: created.userId } });
    expect(isAgentEmail(user.email)).toBe(true);
    expect(user.passwordHash).toBeNull();
    expect(user.name).toBe("Desk Claude");
    const membership = await db.membership.findFirstOrThrow({ where: { organizationId, userId: created.userId } });
    expect(membership.status).toBe("ACTIVE");
    expect(membership.roleId).toBe(ownerMembership.roleId);
    const agent = await db.aiAgent.findUniqueOrThrow({ where: { id: created.agentId } });
    expect(agent).toMatchObject({ ownerUserId: ownerId, platform: "claude", connection: "oauth", name: "Desk Claude" });
    expect(await db.auditLog.count({ where: { organizationId, action: "agents.agent.created", targetId: created.agentId } })).toBe(1);

    // The only seat is the owner's; agents do not count, so a person still cannot be added.
    await expect(addOrganizationMember({ organizationId, email: `late-${suffix}@example.com`, roleId: membership.roleId, actorId })).rejects.toThrow(/no open seats/);
  });

  it("only lets an active person of the same organization own an agent", async () => {
    const [organizationId, otherOrganizationId] = orgIds as [string, string];
    await expect(createAgentMember({ organizationId: otherOrganizationId, ownerUserId: ownerId, name: "Stray", platform: "grok", connection: "key", actorId })).rejects.toThrow(/active member/);
    const agent = await db.aiAgent.findFirstOrThrow({ where: { organizationId } });
    await expect(createAgentMember({ organizationId, ownerUserId: agent.userId, name: "Nested", platform: "grok", connection: "key", actorId })).rejects.toThrow(/cannot own another agent/);
    const foreignRole = await db.role.findFirstOrThrow({ where: { organizationId: otherOrganizationId } });
    await expect(createAgentMember({ organizationId, ownerUserId: ownerId, name: "Wrong role", platform: "grok", connection: "key", roleId: foreignRole.id, actorId })).rejects.toThrow(/role of this organization/);
  });

  it("is invisible to other organizations", async () => {
    const [organizationId, otherOrganizationId] = orgIds as [string, string];
    expect(await tenantDb(organizationId).aiAgent.count()).toBeGreaterThan(0);
    expect(await tenantDb(otherOrganizationId).aiAgent.count()).toBe(0);
  });

  it("removal disables the membership and revokes every token", async () => {
    const [organizationId] = orgIds as [string];
    const agent = await db.aiAgent.findFirstOrThrow({ where: { organizationId } });
    await tenantDb(organizationId).aiAgentToken.create({ data: { organizationId, agentId: agent.id, kind: "key", prefix: "pca_test", tokenHash: `hash-${suffix}` } });
    await removeAgentMember({ organizationId, agentId: agent.id, actorId: ownerId });
    expect((await db.membership.findFirstOrThrow({ where: { organizationId, userId: agent.userId } })).status).toBe("DISABLED");
    expect(await db.aiAgentToken.count({ where: { agentId: agent.id, revokedAt: null } })).toBe(0);
    expect((await db.aiAgent.findUniqueOrThrow({ where: { id: agent.id } })).removedAt).not.toBeNull();
    await expect(removeAgentMember({ organizationId, agentId: agent.id, actorId: ownerId })).rejects.toThrow(/no longer exists/);
  });
});
