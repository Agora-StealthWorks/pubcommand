import { randomBytes } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { provisionOrganization } from "./provision";
import { tenantDb } from "./tenant";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/pubcommand";
process.env.DATABASE_URL = databaseUrl;

describe("Publication Setup owns calendar_publications without breaking the calendar", () => {
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const suffix = randomBytes(4).toString("hex");
  const emails = [`ps-a-${suffix}@example.com`, `ps-b-${suffix}@example.com`, `ps-staff-${suffix}@example.com`];
  const orgs: { id: string; brandId: string }[] = [];
  let planId = "";

  beforeAll(async () => {
    execSync("pnpm exec prisma migrate deploy --schema prisma/schema", { cwd: new URL("..", import.meta.url).pathname, env: process.env, stdio: "inherit" });
    planId = (await db.plan.create({ data: { key: `ps-${suffix}`, name: "PS", seatLimit: 5, monthlyPriceCents: 0 } })).id;
    const staff = await db.user.create({ data: { email: emails[2]! } });
    for (const [index, email] of emails.slice(0, 2).entries()) {
      const created = await provisionOrganization({
        name: `PS ${index}`,
        slug: `ps-${index}-${suffix}`,
        planId,
        adminEmail: email,
        actorId: staff.id,
        actorEmail: emails[2]!,
        permissionKeys: ["pubsetup.manage", "editorial.read"],
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

  it("still accepts a publication written the old calendar way, with Publication Setup defaults", async () => {
    const [a] = orgs as [{ id: string; brandId: string }];
    const pub = await tenantDb(a.id).calendarPublication.create({ data: { organizationId: a.id, brandId: a.brandId, code: "OLD", name: "Old style" } });
    expect(pub.slug).toBeNull();
    expect(pub.status).toBe("active");
    expect(pub.active).toBe(true);
    expect(pub.deliverables).toEqual([]);
    expect(pub.deletedAt).toBeNull();
    // Issues still find it by code, as send stats and Mini-Blog do.
    await tenantDb(a.id).calendarIssue.create({ data: { organizationId: a.id, brandId: a.brandId, publicationCode: "OLD", title: "Issue 1" } });
    const found = await tenantDb(a.id).calendarPublication.findFirst({ where: { brandId: a.brandId, code: "OLD", active: true } });
    expect(found?.id).toBe(pub.id);
  });

  it("keeps slugs unique per brand and links editors with a role", async () => {
    const [a] = orgs as [{ id: string; brandId: string }];
    const t = tenantDb(a.id);
    const pub = await t.calendarPublication.create({ data: { organizationId: a.id, brandId: a.brandId, code: "EDGE", name: "Edge", slug: "edge" } });
    await expect(t.calendarPublication.create({ data: { organizationId: a.id, brandId: a.brandId, code: "EDGE2", name: "Edge 2", slug: "edge" } })).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    const editor = await t.pubEditor.create({ data: { organizationId: a.id, brandId: a.brandId, name: "Ada Lee", slug: "ada-lee" } });
    await expect(t.pubEditor.create({ data: { organizationId: a.id, brandId: a.brandId, name: "Ada Lee", slug: "ada-lee" } })).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    await t.pubPublicationEditor.create({ data: { organizationId: a.id, publicationId: pub.id, editorId: editor.id, role: "lead" } });
    const withEditors = await t.calendarPublication.findFirst({ where: { id: pub.id }, select: { editorLinks: { select: { role: true, editor: { select: { name: true } } } } } });
    expect(withEditors?.editorLinks).toEqual([{ role: "lead", editor: { name: "Ada Lee" } }]);
    await t.calendarPublication.deleteMany({ where: { id: pub.id } });
    expect(await t.pubPublicationEditor.count({ where: { editorId: editor.id } })).toBe(0);
  });

  it("keeps editors and brand branding inside their organization", async () => {
    const [a, b] = orgs as [{ id: string; brandId: string }, { id: string; brandId: string }];
    await tenantDb(a.id).pubEditor.create({ data: { organizationId: a.id, brandId: a.brandId, name: "Only A", slug: `only-a-${suffix}` } });
    await tenantDb(a.id).pubBrandBranding.create({ data: { organizationId: a.id, brandId: a.brandId, primaryColor: "#112233" } });
    expect(await tenantDb(b.id).pubEditor.count({ where: { name: "Only A" } })).toBe(0);
    expect(await tenantDb(b.id).pubBrandBranding.count()).toBe(0);
    expect(await tenantDb(b.id).calendarPublication.count()).toBe(0);
  });

  it("grants pubsetup.manage to the admin role a new organization gets", async () => {
    const [a] = orgs as [{ id: string; brandId: string }];
    const admin = await db.role.findFirstOrThrow({ where: { organizationId: a.id, slug: "admin" }, include: { grants: true } });
    expect(admin.grants.map((p) => p.permission)).toContain("pubsetup.manage");
  });

  it("seeds categories from each brand's types once, keeps them per brand and inside RLS", async () => {
    const [a, b] = orgs as [{ id: string; brandId: string }, { id: string; brandId: string }];
    const ta = tenantDb(a.id);
    const mk = (t: typeof ta, org: { id: string; brandId: string }, code: string, pubType: string | null) =>
      t.calendarPublication.create({ data: { organizationId: org.id, brandId: org.brandId, code: `${code}${suffix}`.slice(0, 20).toUpperCase(), name: code, pubType } });
    const p1 = await mk(ta, a, "SA", "Paid newsletter");
    const p2 = await mk(ta, a, "SB", "Free newsletter");
    const p3 = await mk(ta, a, "SC", "free newsletter");
    const p4 = await mk(ta, a, "SD", null);
    const p5 = await mk(tenantDb(b.id), b, "SE", "Paid newsletter");
    // An admin already made "PAID NEWSLETTER" in brand A: the seed must reuse it, not add another.
    const existing = await ta.pubCategory.create({ data: { organizationId: a.id, brandId: a.brandId, name: "PAID NEWSLETTER", sortOrder: 99 } });
    const sql = readFileSync(new URL("../prisma/schema/migrations/20261122120000_websites_members_categories/migration.sql", import.meta.url), "utf8");
    const seed = sql.slice(sql.indexOf("-- seed:begin"), sql.indexOf("-- seed:end"));
    const statements = seed.split(/;\s*\n/).map((part) => part.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean);
    for (let run = 0; run < 2; run += 1) for (const statement of statements) await db.$executeRawUnsafe(statement);

    const catsA = await ta.pubCategory.findMany({ where: { brandId: a.brandId }, orderBy: { sortOrder: "asc" } });
    expect(catsA.map((c) => c.name).sort()).toEqual(["Free newsletter", "PAID NEWSLETTER"]);
    expect(catsA.find((c) => c.name === "Free newsletter")?.sortOrder).toBe(10);
    const byId = async (id: string) => (await ta.calendarPublication.findFirst({ where: { id } }))!.categoryId;
    expect(await byId(p1.id)).toBe(existing.id);
    expect(await byId(p2.id)).toBe(await byId(p3.id));
    expect(await byId(p4.id)).toBeNull();
    const catsB = await tenantDb(b.id).pubCategory.findMany({ where: { brandId: b.brandId } });
    expect(catsB.map((c) => c.name)).toEqual(["Paid newsletter"]);
    expect((await tenantDb(b.id).calendarPublication.findFirst({ where: { id: p5.id } }))!.categoryId).toBe(catsB[0]!.id);
    // RLS: org B cannot see org A's categories.
    expect(await tenantDb(b.id).pubCategory.count({ where: { brandId: a.brandId } })).toBe(0);
    // Deleting a category leaves its publications uncategorized (ON DELETE SET NULL).
    await ta.pubCategory.deleteMany({ where: { id: existing.id } });
    expect(await byId(p1.id)).toBeNull();
  });
});
