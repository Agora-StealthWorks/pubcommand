import { randomBytes } from "node:crypto";
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PLATFORM_STAFF_MANAGER_EMAIL } from "@pubcommand/core";
import {
  resetUserTwoFactor,
  revokeUserSessions,
  setPlatformStaffAccess,
  setUserDisabled,
  setUserPasswordHash,
  updateUserProfile,
} from "./accounts";
import { changeOrganizationMemberRole, provisionOrganization } from "./provision";
import { ensureSuperadmin } from "./superadmin";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/pubcommand";
process.env.DATABASE_URL = databaseUrl;

describe("account administration", () => {
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const suffix = randomBytes(4).toString("hex");
  const superEmail = `accounts-super-${suffix}@example.com`;
  const billingEmail = `accounts-billing-${suffix}@example.com`;
  const otherEmail = `accounts-other-${suffix}@example.com`;
  const targetEmail = `accounts-person-${suffix}@example.com`;
  const orgAdminEmail = `accounts-member-${suffix}@example.com`;
  let superId = "";
  let billingId = "";
  let otherId = "";
  let targetId = "";
  let stephenId = "";
  let organizationId = "";
  let planId = "";

  beforeAll(async () => {
    execSync("pnpm exec prisma migrate deploy --schema prisma/schema.prisma", {
      cwd: new URL("..", import.meta.url).pathname,
      env: process.env,
      stdio: "inherit",
    });
    const superUser = await db.user.create({ data: { email: superEmail, name: "Super", passwordHash: null } });
    const billing = await db.user.create({ data: { email: billingEmail, passwordHash: null } });
    const other = await db.user.create({ data: { email: otherEmail, passwordHash: null } });
    const target = await db.user.create({ data: { email: targetEmail, name: "Pat", passwordHash: null } });
    superId = superUser.id;
    billingId = billing.id;
    otherId = other.id;
    targetId = target.id;
    await db.platformStaff.create({ data: { userId: superId, role: "SUPER_ADMIN" } });
    await db.platformStaff.create({ data: { userId: billingId, role: "BILLING" } });
    await db.platformStaff.create({ data: { userId: otherId, role: "SUPER_ADMIN" } });
    await db.platformStaff.create({
      data: { userId: targetId, role: "SUPPORT", totpSecretCipher: "cipher", totpConfirmedAt: new Date() },
    });
    const stephen = await ensureSuperadmin();
    stephenId = stephen.userId;
    const plan = await db.plan.create({
      data: { key: `accounts-${suffix}`, name: "Accounts", seatLimit: 5, brandLimit: 2, workspaceLimit: 2, monthlyPriceCents: 0 },
    });
    planId = plan.id;
    const organization = await provisionOrganization({
      name: "Accounts Desk",
      slug: `accounts-${suffix}`,
      planId,
      adminEmail: orgAdminEmail,
      actorId: superId,
      actorEmail: superEmail,
      permissionKeys: ["settings.manage"],
    });
    organizationId = organization.organizationId;
  });

  afterAll(async () => {
    if (organizationId) await db.organization.deleteMany({ where: { id: organizationId } });
    await db.session.deleteMany({ where: { userId: { in: [superId, billingId, otherId, targetId] } } });
    await db.user.deleteMany({ where: { email: { in: [superEmail, billingEmail, otherEmail, targetEmail, orgAdminEmail] } } });
    if (planId) await db.plan.deleteMany({ where: { id: planId } });
    await db.$disconnect();
  });

  it("refuses staff changes from anyone except Stephen and refuses self lockout", async () => {
    await expect(setPlatformStaffAccess({ actorId: otherId, userId: targetId, role: "OPS" })).rejects.toThrow(/Only Stephen/);
    await expect(setPlatformStaffAccess({ actorId: billingId, userId: targetId, role: "OPS" })).rejects.toThrow(/Only Stephen/);
    await expect(setUserDisabled({ actorId: billingId, userId: targetId, disabled: true })).rejects.toThrow(/permission/);
    await expect(setUserDisabled({ actorId: superId, userId: superId, disabled: true })).rejects.toThrow(/own account/);
    await expect(setUserDisabled({ actorId: superId, userId: stephenId, disabled: true })).rejects.toThrow(/cannot disable that account/);
    await expect(setPlatformStaffAccess({ actorId: stephenId, userId: stephenId, role: "SUPPORT" })).rejects.toThrow(
      /own super admin/,
    );
    await expect(setPlatformStaffAccess({ actorId: stephenId, userId: stephenId, role: null })).rejects.toThrow(/own super admin/);
    const stephen = await db.user.findUniqueOrThrow({ where: { id: stephenId }, include: { staff: true } });
    expect(stephen.disabledAt).toBeNull();
    expect(stephen.staff?.role).toBe("SUPER_ADMIN");
    expect(stephen.staff?.disabledAt).toBeNull();
    await expect(
      updateUserProfile({ actorId: superId, userId: stephenId, name: "Stephen Prior", email: `moved-${suffix}@example.com` }),
    ).rejects.toThrow(/staff manager email/);
    const email = await db.user.findUniqueOrThrow({ where: { id: stephenId } });
    expect(email.email.toLowerCase()).toBe(PLATFORM_STAFF_MANAGER_EMAIL);
  });

  it("lets a super admin edit a user and lets Stephen change staff", async () => {
    await updateUserProfile({ actorId: superId, userId: targetId, name: "Pat Example", email: targetEmail });
    await setUserPasswordHash({ actorId: superId, userId: targetId, passwordHash: "$2b$12$accounts.test.hash.value" });
    await db.session.create({
      data: { id: `sess-${suffix}`, userId: targetId, expiresAt: new Date(Date.now() + 86_400_000) },
    });
    expect(await revokeUserSessions({ actorId: superId, userId: targetId })).toBe(1);
    expect(await db.session.count({ where: { userId: targetId } })).toBe(0);
    await resetUserTwoFactor({ actorId: superId, userId: targetId });
    const reset = await db.platformStaff.findUniqueOrThrow({ where: { userId: targetId } });
    expect(reset.totpSecretCipher).toBeNull();
    expect(reset.totpConfirmedAt).toBeNull();

    await setUserDisabled({ actorId: superId, userId: targetId, disabled: true });
    expect((await db.user.findUniqueOrThrow({ where: { id: targetId } })).disabledAt).not.toBeNull();
    await setUserDisabled({ actorId: superId, userId: targetId, disabled: false });
    expect((await db.user.findUniqueOrThrow({ where: { id: targetId } })).disabledAt).toBeNull();

    await setPlatformStaffAccess({ actorId: stephenId, userId: targetId, role: "OPS" });
    expect((await db.platformStaff.findUniqueOrThrow({ where: { userId: targetId } })).role).toBe("OPS");
    await setPlatformStaffAccess({ actorId: stephenId, userId: targetId, role: null });
    expect((await db.platformStaff.findUniqueOrThrow({ where: { userId: targetId } })).disabledAt).not.toBeNull();

    const membership = await db.membership.findFirstOrThrow({ where: { organizationId, user: { email: orgAdminEmail } } });
    const admin = await db.role.findFirstOrThrow({ where: { organizationId, slug: "admin" } });
    await changeOrganizationMemberRole({ organizationId, membershipId: membership.id, roleId: admin.id, actorId: superId });
    const updated = await db.membership.findUniqueOrThrow({ where: { id: membership.id }, include: { role: true } });
    expect(updated.role.slug).toBe("admin");

    const actions = await db.platformAuditLog.findMany({
      where: { targetId: { in: [targetId, membership.id] } },
      select: { action: true },
    });
    expect(actions.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "user.updated",
        "user.password.reset",
        "user.sessions.revoked",
        "user.totp.reset",
        "user.disabled",
        "user.enabled",
        "staff.role.changed",
        "staff.removed",
        "org.member.role",
      ]),
    );
  });
});
