import { randomBytes } from "node:crypto";
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  activateInvitedMemberships,
  addOrganizationMember,
  addStaffAsOrganizationAdmin,
  assignOrganizationPlan,
  provisionOrganization,
  removeOrganizationMember,
  setOrganizationSuspended,
} from "./provision";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/pubcommand";
process.env.DATABASE_URL = databaseUrl;

describe("organization provisioning", () => {
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const suffix = randomBytes(4).toString("hex");
  const permissions = ["settings.manage", "knowledge.read"];
  const adminEmail = `owner-${suffix}@example.com`;
  const actorEmail = `staff-${suffix}@example.com`;
  const guestEmail = `guest-${suffix}@example.com`;
  const slug = `desk-${suffix}`;
  let actorId = "";
  let planId = "";
  let plusPlanId = "";
  let organizationId = "";
  const extraOrgIds: string[] = [];

  beforeAll(async () => {
    execSync("pnpm exec prisma migrate deploy --schema prisma/schema", {
      cwd: new URL("..", import.meta.url).pathname,
      env: process.env,
      stdio: "inherit",
    });
    const actor = await db.user.create({ data: { email: actorEmail, passwordHash: null } });
    actorId = actor.id;
    const plan = await db.plan.create({
      data: { key: `plan-${suffix}`, name: "Desk", seatLimit: 2, monthlyPriceCents: 0 },
    });
    planId = plan.id;
    await db.planModule.create({ data: { planId, moduleId: "knowledge" } });
    const plus = await db.plan.create({
      data: { key: `plus-${suffix}`, name: "Plus", seatLimit: 8, monthlyPriceCents: 100 },
    });
    plusPlanId = plus.id;
  });

  afterAll(async () => {
    const orgIds = [organizationId, ...extraOrgIds].filter(Boolean);
    if (orgIds.length > 0) await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    await db.user.deleteMany({ where: { email: { in: [adminEmail, actorEmail, guestEmail] } } });
    await db.plan.deleteMany({ where: { key: { in: [`plan-${suffix}`, `plus-${suffix}`] } } });
    await db.$disconnect();
  });

  it("creates the org, default brand and workspace, owner membership, and audit rows", async () => {
    const created = await provisionOrganization({
      name: "Northstar Desk",
      slug,
      planId,
      adminEmail,
      actorId,
      actorEmail,
      permissionKeys: permissions,
    });
    organizationId = created.organizationId;
    expect(created.membershipStatus).toBe("INVITED");
    expect(created.slug).toBe(slug);

    const organization = await db.organization.findUniqueOrThrow({
      where: { id: created.organizationId },
      include: {
        brands: { include: { workspaces: true } },
        roles: { include: { grants: true } },
        memberships: { include: { user: true, role: true } },
        modules: true,
        settings: true,
      },
    });
    expect(organization.seatLimit).toBe(2);
    expect(organization.brands.map((brand) => brand.slug)).toEqual(["northstar-desk"]);
    expect(organization.brands[0]?.workspaces.map((workspace) => workspace.slug)).toEqual(["default"]);
    expect(organization.settings?.displayName).toBe("Northstar Desk");
    expect(organization.modules.map((row) => row.moduleId).sort()).toEqual(["knowledge", "settings"]);
    const owner = organization.roles.find((role) => role.slug === "owner");
    const admin = organization.roles.find((role) => role.slug === "admin");
    expect(owner?.grants.map((grant) => grant.permission).sort()).toEqual(["knowledge.read", "settings.manage"]);
    expect(admin?.grants.map((grant) => grant.permission).sort()).toEqual(["knowledge.read", "settings.manage"]);
    expect(organization.memberships).toEqual([
      expect.objectContaining({
        status: "INVITED",
        role: expect.objectContaining({ slug: "owner" }),
        user: expect.objectContaining({ email: adminEmail }),
      }),
    ]);
    const audit = await db.platformAuditLog.findFirst({
      where: { action: "org.created", targetId: organization.id },
    });
    expect(audit?.actorId).toBe(actorId);
    const orgAudit = await db.auditLog.findFirst({
      where: { organizationId: organization.id, action: "org.created" },
    });
    expect(orgAudit).not.toBeNull();
  });

  it("rejects reserved and taken subdomains", async () => {
    for (const reserved of ["admin", "app", "www", "api"]) {
      await expect(
        provisionOrganization({
          name: "Reserved",
          slug: reserved,
          planId,
          adminEmail,
          actorId,
          actorEmail,
          permissionKeys: permissions,
        }),
      ).rejects.toThrow(/reserved/);
    }
    await expect(
      provisionOrganization({
        name: "Copy",
        slug,
        planId,
        adminEmail: guestEmail,
        actorId,
        actorEmail,
        permissionKeys: permissions,
      }),
    ).rejects.toThrow(/already in use/);
  });

  it("lets staff join as an admin, invites members, and records each change", async () => {
    const self = await addStaffAsOrganizationAdmin({
      organizationId,
      userId: actorId,
      actorId,
      permissionKeys: permissions,
    });
    expect(self.changed).toBe(true);
    const again = await addStaffAsOrganizationAdmin({
      organizationId,
      userId: actorId,
      actorId,
      permissionKeys: permissions,
    });
    expect(again.changed).toBe(false);

    await expect(
      addOrganizationMember({
        organizationId,
        email: guestEmail,
        roleId: (await db.role.findFirstOrThrow({ where: { organizationId, slug: "admin" } })).id,
        actorId,
      }),
    ).rejects.toThrow(/no open seats/);

    const owner = await db.membership.findFirstOrThrow({
      where: { organizationId, user: { email: adminEmail } },
    });
    await removeOrganizationMember({ organizationId, membershipId: owner.id, actorId });
    const removed = await db.membership.findUniqueOrThrow({ where: { id: owner.id } });
    expect(removed.status).toBe("DISABLED");

    const invited = await addOrganizationMember({
      organizationId,
      email: guestEmail,
      roleId: (await db.role.findFirstOrThrow({ where: { organizationId, slug: "admin" } })).id,
      actorId,
    });
    expect(invited.status).toBe("INVITED");
    const activated = await activateInvitedMemberships(invited.userId);
    expect(activated).toContain(organizationId);
    const guest = await db.membership.findFirstOrThrow({ where: { organizationId, userId: invited.userId } });
    expect(guest.status).toBe("ACTIVE");

    const plan = await assignOrganizationPlan({ organizationId, planId: plusPlanId, actorId });
    expect(plan.name).toBe("Plus");
    const updated = await db.organization.findUniqueOrThrow({ where: { id: organizationId } });
    expect(updated.seatLimit).toBe(8);

    await setOrganizationSuspended({ organizationId, suspend: true, actorId });
    const suspended = await db.organization.findUniqueOrThrow({ where: { id: organizationId } });
    expect(suspended.suspendedAt).not.toBeNull();
    await setOrganizationSuspended({ organizationId, suspend: false, actorId });

    const actions = await db.platformAuditLog.findMany({
      where: { targetId: { in: [organizationId, actorId, invited.userId, owner.userId] } },
      select: { action: true },
    });
    const names = actions.map((row) => row.action);
    expect(names).toEqual(expect.arrayContaining([
      "org.member.added",
      "org.member.removed",
      "org.member.invited",
      "org.plan.changed",
      "org.suspended",
      "org.unsuspended",
    ]));
  });

  it("activates the first admin when that person is the staff member creating it", async () => {
    const created = await provisionOrganization({
      name: "Staff Desk",
      slug: `self-${suffix}`,
      planId,
      adminEmail: actorEmail,
      actorId,
      actorEmail,
      permissionKeys: permissions,
    });
    extraOrgIds.push(created.organizationId);
    expect(created.membershipStatus).toBe("ACTIVE");
    expect(created.userId).toBe(actorId);
  });
});
