import { randomBytes } from "node:crypto";
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { moduleRegistry } from "@pubcommand/modules";
import { provisionOrganization } from "./provision";
import { ensureBuiltInRolesForAll } from "./roles";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/pubcommand";
process.env.DATABASE_URL = databaseUrl;

const ALL = [...new Set(moduleRegistry.all().flatMap((manifest) => manifest.permissions.map((permission) => permission.key)))].sort();

describe("owner always has every permission", () => {
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const suffix = randomBytes(4).toString("hex");
  let organizationId = "";
  let planId = "";

  beforeAll(async () => {
    execSync("pnpm exec prisma migrate deploy --schema prisma/schema", {
      cwd: new URL("..", import.meta.url).pathname,
      env: process.env,
      stdio: "inherit",
    });
    const plan = await db.plan.create({
      data: { key: `owner-${suffix}`, name: "Owner", seatLimit: 5, brandLimit: 1, workspaceLimit: 1, monthlyPriceCents: 0 },
    });
    planId = plan.id;
    const creator = await db.user.create({ data: { email: `owner-creator-${suffix}@example.com`, passwordHash: null } });
    // A caller that passes only one key: the Owner still gets everything.
    const org = await provisionOrganization({
      name: "Owner Grants",
      slug: `owner-${suffix}`,
      planId,
      adminEmail: `owner-admin-${suffix}@example.com`,
      actorId: creator.id,
      actorEmail: creator.email,
      permissionKeys: ["settings.manage"],
    });
    organizationId = org.organizationId;
  });

  afterAll(async () => {
    if (organizationId) await db.organization.deleteMany({ where: { id: organizationId } });
    await db.user.deleteMany({ where: { email: { in: [`owner-creator-${suffix}@example.com`, `owner-admin-${suffix}@example.com`] } } });
    if (planId) await db.plan.deleteMany({ where: { id: planId } });
    await db.$disconnect();
  });

  const ownerGrants = async () => {
    const owner = await db.role.findFirstOrThrow({ where: { organizationId, slug: "owner" }, include: { grants: true } });
    return { owner, grants: owner.grants };
  };

  it("provisioning grants the Owner every manifest permission", async () => {
    const { grants } = await ownerGrants();
    expect(grants.map((grant) => grant.permission).sort()).toEqual(ALL);
    const admin = await db.role.findFirstOrThrow({ where: { organizationId, slug: "admin" }, include: { grants: true } });
    expect(admin.grants.map((grant) => grant.permission)).toEqual(["settings.manage"]);
  });

  it("the boot step adds missing Owner grants, insert-only", async () => {
    const { owner } = await ownerGrants();
    await db.rolePermission.deleteMany({ where: { roleId: owner.id, permission: { in: ["websites.read", "charts.write"] } } });
    await db.rolePermission.updateMany({ where: { roleId: owner.id, permission: "forms.export" }, data: { effect: "DENY" } });
    await db.rolePermission.create({ data: { organizationId, roleId: owner.id, permission: "retired.permission", effect: "ALLOW" } });
    const result = await ensureBuiltInRolesForAll();
    expect(result.ownerGrantsAdded).toBeGreaterThanOrEqual(2);
    const { grants } = await ownerGrants();
    const keys = grants.map((grant) => grant.permission);
    for (const key of ALL) expect(keys).toContain(key);
    expect(keys).toContain("retired.permission");
    expect(grants.find((grant) => grant.permission === "forms.export")?.effect).toBe("DENY");
    expect((await ensureBuiltInRolesForAll()).ownerGrantsAdded).toBe(0);
  });
});
