import { randomBytes } from "node:crypto";
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadAccessSubject, loadSuperAdminSubject } from "./access";
import { activateInvitedMemberships, provisionOrganization } from "./provision";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/pubcommand";
process.env.DATABASE_URL = databaseUrl;

const permissionModules = { "knowledge.read": "knowledge", "editorial.read": "editorial" };

describe("org access after sign-in", () => {
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const suffix = randomBytes(4).toString("hex");
  const adminEmail = `invitee-${suffix}@example.com`;
  const staffEmail = `boss-${suffix}@example.com`;
  let organizationId = "";
  let staffId = "";
  let planId = "";

  beforeAll(async () => {
    execSync("pnpm exec prisma migrate deploy --schema prisma/schema", {
      cwd: new URL("..", import.meta.url).pathname,
      env: process.env,
      stdio: "inherit",
    });
    const plan = await db.plan.create({ data: { key: `acc-${suffix}`, name: "Acc", seatLimit: 5, monthlyPriceCents: 0 } });
    planId = plan.id;
    await db.planModule.create({ data: { planId, moduleId: "knowledge" } });
    const staff = await db.user.create({ data: { email: staffEmail } });
    staffId = staff.id;
    const created = await provisionOrganization({
      name: "Access Desk",
      slug: `access-${suffix}`,
      planId,
      adminEmail,
      actorId: staffId,
      actorEmail: staffEmail,
      permissionKeys: Object.keys(permissionModules),
    });
    organizationId = created.organizationId;
  });

  afterAll(async () => {
    if (organizationId) await db.organization.deleteMany({ where: { id: organizationId } });
    await db.user.deleteMany({ where: { email: { in: [adminEmail, staffEmail] } } });
    await db.plan.deleteMany({ where: { id: planId } });
    await db.$disconnect();
  });

  it("an invited user gets access once any sign-in activates the invite", async () => {
    const invitee = await db.user.findFirstOrThrow({ where: { email: adminEmail } });
    expect(await loadAccessSubject(organizationId, invitee.id, permissionModules)).toBeNull();
    await activateInvitedMemberships(invitee.id);
    const subject = await loadAccessSubject(organizationId, invitee.id, permissionModules);
    expect(subject?.organizationId).toBe(organizationId);
  });

  it("the super admin subject covers every module and permission without a membership", async () => {
    expect(await loadAccessSubject(organizationId, staffId, permissionModules)).toBeNull();
    const subject = await loadSuperAdminSubject(organizationId, staffId, permissionModules);
    expect(subject?.entitledModuleIds).toEqual(expect.arrayContaining(["knowledge", "editorial", "settings"]));
    expect(subject?.grants.map((grant) => grant.permission).sort()).toEqual(["editorial.read", "knowledge.read"]);
  });

  it("the super admin subject still honors an org turning a module off", async () => {
    await db.organizationModule.create({ data: { organizationId, moduleId: "editorial", enabled: false } });
    const subject = await loadSuperAdminSubject(organizationId, staffId, permissionModules);
    expect(subject?.entitledModuleIds).not.toContain("editorial");
  });
});
