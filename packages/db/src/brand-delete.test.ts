import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { provisionOrganization } from "./provision";
import { tenantDb } from "./tenant";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/pubcommand";
process.env.DATABASE_URL = databaseUrl;

describe("removing a brand", () => {
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const suffix = randomBytes(4).toString("hex");
  const emails = [`o-${suffix}@example.com`, `s-${suffix}@example.com`];
  let orgId = "";
  let planId = "";

  afterAll(async () => {
    if (orgId) await db.organization.deleteMany({ where: { id: orgId } });
    await db.user.deleteMany({ where: { email: { in: emails } } });
    if (planId) await db.plan.deleteMany({ where: { id: planId } });
    await db.$disconnect();
  });

  it("deletes the brand and its data through the tenant client, and keeps the other brand", async () => {
    const actor = await db.user.create({ data: { email: emails[1]!, passwordHash: null } });
    planId = (await db.plan.create({ data: { key: `bd-${suffix}`, name: "BD", seatLimit: 2, monthlyPriceCents: 0 } })).id;
    orgId = (await provisionOrganization({ name: "BD", slug: `bd-${suffix}`, planId, adminEmail: emails[0]!, actorId: actor.id, actorEmail: emails[1]!, permissionKeys: [] })).organizationId;
    const t = tenantDb(orgId);
    const second = await t.brand.create({ data: { organizationId: orgId, name: "Second", slug: "second" } });
    await t.workspace.create({ data: { organizationId: orgId, brandId: second.id, name: "General", slug: "general" } });
    await t.knowledgePage.create({ data: { organizationId: orgId, brandId: second.id, title: "Note", slug: "note", body: "x" } });
    const removed = await t.brand.deleteMany({ where: { id: second.id } });
    expect(removed.count).toBe(1);
    expect(await db.knowledgePage.count({ where: { brandId: second.id } })).toBe(0);
    expect(await db.workspace.count({ where: { brandId: second.id } })).toBe(0);
    expect(await db.brand.count({ where: { organizationId: orgId } })).toBe(1);
    // Another org's tenant client cannot delete this org's brand.
    const other = (await db.brand.findFirstOrThrow({ where: { organizationId: orgId } })).id;
    expect((await tenantDb("00000000-0000-4000-8000-000000000000").brand.deleteMany({ where: { id: other } })).count).toBe(0);
  });
});
