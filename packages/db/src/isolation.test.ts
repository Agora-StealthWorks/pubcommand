import { randomBytes } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RESERVED_SLUGS } from "@pubcommand/core";
import { PrismaClient } from "@prisma/client";
import { PlatformAuditImmutableError, getPrisma } from "./client";
import { createTenantClient, withOrgContext } from "./tenant";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/pubcommand";
process.env.DATABASE_URL = databaseUrl;

describe("tenant isolation", () => {
  const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  let app: PrismaClient;
  let orgA = "";
  let orgB = "";
  let brandA = "";
  let brandB = "";
  const password = randomBytes(18).toString("hex");

  beforeAll(async () => {
    execSync("pnpm exec prisma migrate deploy --schema prisma/schema.prisma", {
      cwd: new URL("..", import.meta.url).pathname,
      env: process.env,
      stdio: "inherit",
    });
    await admin.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pubcommand_app') THEN
          CREATE ROLE pubcommand_app LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS;
        ELSE
          ALTER ROLE pubcommand_app WITH LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS;
        END IF;
      END $$;
    `);
    await admin.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO pubcommand_app`);
    await admin.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pubcommand_app`);
    await admin.$executeRawUnsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pubcommand_app`);
    await admin.$executeRawUnsafe(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO pubcommand_app`);
    const plan = await admin.plan.create({
      data: { key: `plan-${password.slice(0, 8)}`, name: "Isolation", seatLimit: 2 },
    });
    const a = await admin.organization.create({
      data: { name: "Org A", slug: `oa${password.slice(0, 8)}`, planId: plan.id, seatLimit: 2 },
    });
    const b = await admin.organization.create({
      data: { name: "Org B", slug: `ob${password.slice(0, 8)}`, planId: plan.id, seatLimit: 2 },
    });
    orgA = a.id;
    orgB = b.id;
    brandA = (
      await admin.brand.create({ data: { organizationId: orgA, name: "Brand A", slug: "brand-a" } })
    ).id;
    brandB = (
      await admin.brand.create({ data: { organizationId: orgB, name: "Brand B", slug: "brand-b" } })
    ).id;
    app = new PrismaClient({
      datasources: {
        db: { url: `postgresql://pubcommand_app:${password}@127.0.0.1:5432/pubcommand` },
      },
    });
  });

  afterAll(async () => {
    if (orgA && orgB) {
      await admin.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    }
    await admin.plan.deleteMany({ where: { key: { startsWith: "plan-" } } });
    await admin.$disconnect();
    await app?.$disconnect();
  });

  it("hides org B from org A through row-level security", async () => {
    const own = await withOrgContext(app, orgA, (tx) => tx.brand.findMany());
    expect(own.map((brand) => brand.id)).toEqual([brandA]);
    const peeked = await withOrgContext(app, orgA, (tx) => tx.brand.findUnique({ where: { id: brandB } }));
    expect(peeked).toBeNull();
    const unscoped = await app.brand.findMany();
    expect(unscoped).toEqual([]);
    await expect(
      withOrgContext(app, orgA, (tx) =>
        tx.brand.create({ data: { organizationId: orgB, name: "Sneak", slug: "sneak" } }),
      ),
    ).rejects.toThrow();
  });

  it("hides org B from the Prisma tenant client even as a superuser", async () => {
    const tenant = createTenantClient(admin, orgA);
    const brands = await tenant.brand.findMany();
    expect(brands.map((brand) => brand.id)).toEqual([brandA]);
    expect(await tenant.brand.findUnique({ where: { id: brandB } })).toBeNull();
    await expect(
      tenant.brand.create({ data: { organizationId: orgB, name: "Sneak", slug: "sneak-2" } }),
    ).rejects.toThrow(/Tenant isolation/);
  });

  it("rejects updates and deletes of the platform audit log", async () => {
    const entry = await admin.platformAuditLog.create({
      data: { action: "isolation.test", targetType: "test" },
    });
    await expect(getPrisma().platformAuditLog.update({ where: { id: entry.id }, data: { action: "tamper" } })).rejects.toBeInstanceOf(
      PlatformAuditImmutableError,
    );
    await expect(admin.$executeRaw`UPDATE platform_audit_logs SET action = 'tamper'`).rejects.toThrow(/append-only/);
    await expect(admin.platformAuditLog.delete({ where: { id: entry.id } })).rejects.toThrow(/append-only/);
  });

  it("keeps the reserved slug list in the database migration", () => {
    const sql = readFileSync(new URL("../prisma/migrations/20251115120100_rls/migration.sql", import.meta.url), "utf8");
    for (const slug of RESERVED_SLUGS) expect(sql).toContain(`'${slug}'`);
  });
});
