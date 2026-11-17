import { randomBytes } from "node:crypto";
import { execSync } from "node:child_process";
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
});
