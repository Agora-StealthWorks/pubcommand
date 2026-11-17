import { randomBytes } from "node:crypto";
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { provisionOrganization } from "./provision";
import { tenantDb, TenantIsolationError } from "./tenant";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/pubcommand";
process.env.DATABASE_URL = databaseUrl;

describe("module data stays inside its organization", () => {
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const suffix = randomBytes(4).toString("hex");
  const emails = [`a-${suffix}@example.com`, `b-${suffix}@example.com`, `staff-${suffix}@example.com`];
  const orgs: { id: string; brandId: string }[] = [];
  let planId = "";

  beforeAll(async () => {
    execSync("pnpm exec prisma migrate deploy --schema prisma/schema", {
      cwd: new URL("..", import.meta.url).pathname,
      env: process.env,
      stdio: "inherit",
    });
    planId = (await db.plan.create({ data: { key: `iso-${suffix}`, name: "Iso", seatLimit: 5, monthlyPriceCents: 0 } })).id;
    const staff = await db.user.create({ data: { email: emails[2]! } });
    for (const [index, email] of emails.slice(0, 2).entries()) {
      const created = await provisionOrganization({
        name: `Iso ${index}`,
        slug: `iso-${index}-${suffix}`,
        planId,
        adminEmail: email,
        actorId: staff.id,
        actorEmail: emails[2]!,
        permissionKeys: ["promo.read"],
      });
      const brand = await db.brand.findFirstOrThrow({ where: { organizationId: created.organizationId } });
      orgs.push({ id: created.organizationId, brandId: brand.id });
    }
  });

  afterAll(async () => {
    await db.organization.deleteMany({ where: { id: { in: orgs.map((org) => org.id) } } });
    await db.user.deleteMany({ where: { email: { in: emails } } });
    await db.plan.deleteMany({ where: { id: planId } });
    await db.$disconnect();
  });

  it("an org reads only its own promos and Brain notes", async () => {
    const [a, b] = orgs as [{ id: string; brandId: string }, { id: string; brandId: string }];
    await tenantDb(a.id).promo.create({ data: { organizationId: a.id, brandId: a.brandId, title: "A promo" } });
    await tenantDb(b.id).promo.create({ data: { organizationId: b.id, brandId: b.brandId, title: "B promo" } });
    await tenantDb(a.id).knowledgePage.create({ data: { organizationId: a.id, title: "A note", slug: `a-${suffix}`, body: "x" } });

    expect((await tenantDb(a.id).promo.findMany()).map((row) => row.title)).toEqual(["A promo"]);
    expect((await tenantDb(b.id).promo.findMany()).map((row) => row.title)).toEqual(["B promo"]);
    expect(await tenantDb(b.id).knowledgePage.count()).toBe(0);
    const updated = await tenantDb(b.id).promo.updateMany({ where: { title: "A promo" }, data: { title: "stolen" } });
    expect(updated.count).toBe(0);
  });

  it("refuses to write a row into another org", async () => {
    const [a, b] = orgs as [{ id: string; brandId: string }, { id: string; brandId: string }];
    await expect(
      tenantDb(a.id).promo.create({ data: { organizationId: b.id, brandId: b.brandId, title: "cross" } }),
    ).rejects.toBeInstanceOf(TenantIsolationError);
  });
});

describe("tenant model registry", () => {
  it("includes every table that has an organization id", async () => {
    const { tenantModelNames } = await import("./tenant");
    expect(tenantModelNames()).toEqual(
      expect.arrayContaining(["Organization", "Brand", "Membership", "Promo", "PromoAnalysis", "PromoFile", "KnowledgePage", "AiUsageLog"]),
    );
    expect(tenantModelNames()).not.toContain("User");
    expect(tenantModelNames()).not.toContain("Plan");
  });
});
