import { randomBytes, randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { loadAccessSubject, loadSuperAdminSubject } from "./access";
import { organizationHasModule } from "./entitlements";
import {
  deleteUserAccount,
  purgeOrganization,
  restoreOrganization,
  setOrganizationAppAccess,
  softDeleteOrganization,
  tablesWithOrganizationId,
  userDeleteCheck,
} from "./lifecycle";
import { resolveOrgBySlug } from "./platform";
import { provisionOrganization } from "./provision";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/pubcommand";
process.env.DATABASE_URL = databaseUrl;

type Field = Prisma.DMMF.Field;

describe("platform deletes, purge and app access", () => {
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const suffix = randomBytes(4).toString("hex");
  const emails = [`a-${suffix}@example.com`, `b-${suffix}@example.com`, `staff-${suffix}@example.com`, `member-${suffix}@example.com`];
  const perms = { "knowledge.read": "knowledge", "forms.read": "forms", "charts.read": "charts", "settings.manage": "settings" };
  let planId = "";
  let staffId = "";
  const orgs: { id: string; slug: string; brandId: string; ownerId: string }[] = [];
  const purgedIds: string[] = [];

  beforeAll(async () => {
    execSync("pnpm exec prisma migrate deploy --schema prisma/schema", { cwd: new URL("..", import.meta.url).pathname, env: process.env, stdio: "inherit" });
    planId = (await db.plan.create({ data: { key: `life-${suffix}`, name: "Life", seatLimit: 5, monthlyPriceCents: 0 } })).id;
    await db.planModule.createMany({ data: [{ planId, moduleId: "knowledge" }, { planId, moduleId: "forms" }] });
    staffId = (await db.user.create({ data: { email: emails[2]! } })).id;
    for (const [index, email] of emails.slice(0, 2).entries()) {
      const slug = `life-${index}-${suffix}`;
      const created = await provisionOrganization({
        name: `Life ${index}`,
        slug,
        planId,
        adminEmail: email,
        actorId: staffId,
        actorEmail: emails[2]!,
        permissionKeys: Object.keys(perms),
      });
      await db.membership.updateMany({ where: { organizationId: created.organizationId }, data: { status: "ACTIVE" } });
      const brand = await db.brand.findFirstOrThrow({ where: { organizationId: created.organizationId } });
      orgs.push({ id: created.organizationId, slug, brandId: brand.id, ownerId: created.userId });
    }
  });

  afterAll(async () => {
    const ids = orgs.map((org) => org.id).filter((id) => !purgedIds.includes(id));
    if (ids.length) {
      await db.membership.deleteMany({ where: { organizationId: { in: ids } } });
      await db.organization.deleteMany({ where: { id: { in: ids } } });
    }
    await db.user.deleteMany({ where: { OR: [{ email: { in: emails } }, { email: { startsWith: "deleted-" }, deletedById: staffId }] } });
    await db.plan.deleteMany({ where: { id: planId } });
    await db.$disconnect();
  });

  it("new organizations get the built-in User and Editor roles", async () => {
    const roles = await db.role.findMany({ where: { organizationId: orgs[0]!.id }, select: { slug: true } });
    expect(roles.map((role) => role.slug).sort()).toEqual(["admin", "editor", "owner", "user"]);
  });

  it("a staff override beats the plan for one org only, and settings can't be blocked", async () => {
    const [a, b] = orgs as [(typeof orgs)[0], (typeof orgs)[0]];
    const known = ["knowledge", "forms", "charts", "settings"];
    await setOrganizationAppAccess({ organizationId: a.id, moduleId: "forms", choice: "BLOCKED", actorId: staffId, knownModuleIds: known });
    await setOrganizationAppAccess({ organizationId: a.id, moduleId: "charts", choice: "ALLOWED", actorId: staffId, knownModuleIds: known });
    const subjectA = await loadAccessSubject(a.id, a.ownerId, perms);
    const subjectB = await loadAccessSubject(b.id, b.ownerId, perms);
    expect(subjectA?.entitledModuleIds ? [...subjectA!.entitledModuleIds].sort() : undefined).toEqual(["charts", "knowledge", "settings"]);
    expect(subjectB?.entitledModuleIds ? [...subjectB!.entitledModuleIds].sort() : undefined).toEqual(["forms", "knowledge", "settings"]);
    expect(await organizationHasModule(a.id, "forms")).toBe(false);
    expect(await organizationHasModule(a.id, "charts")).toBe(true);
    const superSubject = await loadSuperAdminSubject(a.id, staffId, perms);
    expect(superSubject?.entitledModuleIds).not.toContain("forms");
    await expect(
      setOrganizationAppAccess({ organizationId: a.id, moduleId: "settings", choice: "BLOCKED", actorId: staffId, knownModuleIds: known }),
    ).rejects.toThrow(/always on/);
    const audits = await db.auditLog.count({ where: { organizationId: a.id, action: "org.app_access.changed" } });
    expect(audits).toBe(2);
    await setOrganizationAppAccess({ organizationId: a.id, moduleId: "forms", choice: "PLAN", actorId: staffId, knownModuleIds: known });
    expect((await loadAccessSubject(a.id, a.ownerId, perms))?.entitledModuleIds).toContain("forms");
  });

  it("soft delete hides the org everywhere, restore brings it back", async () => {
    const a = orgs[0]!;
    await expect(softDeleteOrganization({ organizationId: a.id, actorId: staffId, confirm: "wrong" })).rejects.toThrow(/Type/);
    await softDeleteOrganization({ organizationId: a.id, actorId: staffId, confirm: a.slug });
    expect(await resolveOrgBySlug(a.slug)).toBeNull();
    expect(await loadAccessSubject(a.id, a.ownerId, perms)).toBeNull();
    expect(await organizationHasModule(a.id, "knowledge")).toBe(false);
    const row = await db.organization.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.suspendedAt?.getTime()).toBe(row.deletedAt?.getTime());
    await restoreOrganization({ organizationId: a.id, actorId: staffId });
    const back = await db.organization.findUniqueOrThrow({ where: { id: a.id } });
    expect(back.deletedAt).toBeNull();
    expect(back.suspendedAt).toBeNull();
    expect((await resolveOrgBySlug(a.slug))?.id).toBe(a.id);
    expect(await loadAccessSubject(a.id, a.ownerId, perms)).not.toBeNull();
  });

  it("user delete: blocks self and the last admin, anonymizes otherwise", async () => {
    const a = orgs[0]!;
    expect(await userDeleteCheck(staffId, staffId)).toMatch(/your own/);
    expect(await userDeleteCheck(staffId, a.ownerId)).toMatch(/last admin of Life 0/);
    const role = await db.role.findFirstOrThrow({ where: { organizationId: a.id, slug: "user" } });
    const member = await db.user.create({ data: { email: emails[3]!, name: "Member Person", passwordHash: "x".repeat(30) } });
    await db.membership.create({ data: { organizationId: a.id, userId: member.id, roleId: role.id } });
    await db.session.create({ data: { id: `s-${suffix}`, userId: member.id, expiresAt: new Date(Date.now() + 60_000) } });
    const page = await db.knowledgePage.create({ data: { organizationId: a.id, title: "Authored", slug: `auth-${suffix}`, body: "x", createdById: member.id } as never });
    await expect(deleteUserAccount({ actorId: staffId, userId: member.id, confirm: "nope@example.com" })).rejects.toThrow(/Type/);
    await deleteUserAccount({ actorId: staffId, userId: member.id, confirm: emails[3]! });
    const after = await db.user.findUniqueOrThrow({ where: { id: member.id } });
    expect(after.email).toBe(`deleted-${member.id}@deleted.invalid`);
    expect(after.name).toBeNull();
    expect(after.passwordHash).toBeNull();
    expect(after.disabledAt).not.toBeNull();
    expect(await db.session.count({ where: { userId: member.id } })).toBe(0);
    expect(await db.membership.count({ where: { userId: member.id } })).toBe(0);
    expect(await db.knowledgePage.count({ where: { id: page.id } })).toBe(1);
    expect(await userDeleteCheck(staffId, member.id)).toMatch(/already/);
  });

  it("purge removes every tenant row of one org across module tables and touches no other org", async () => {
    const [a, b] = orgs as [(typeof orgs)[0], (typeof orgs)[0]];
    const seeded = { a: await fillTenantTables(db, a, suffix), b: await fillTenantTables(db, b, suffix) };
    expect(seeded.a.length).toBeGreaterThanOrEqual(120);
    await db.organizationAppAccess.create({ data: { orgId: a.id, moduleId: "intel", access: "ALLOWED" } });
    const tables = await db.$transaction((tx) => tablesWithOrganizationId(tx));
    const countFor = async (orgId: string) => {
      const out: Record<string, number> = {};
      for (const table of tables) {
        const rows = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "${table}" WHERE organization_id = $1::uuid`, orgId);
        out[table] = Number(rows[0]?.n ?? 0);
      }
      return out;
    };
    const beforeB = await countFor(b.id);
    const nonEmptyA = Object.entries(await countFor(a.id)).filter(([, n]) => n > 0).length;
    expect(nonEmptyA).toBeGreaterThanOrEqual(120);
    console.log(`purge test: ${nonEmptyA} of ${tables.length} organization_id tables hold rows for the purged org`);

    await expect(purgeOrganization({ organizationId: a.id, actorId: staffId, confirm: a.slug })).rejects.toThrow(/Delete the organization first/);
    await softDeleteOrganization({ organizationId: a.id, actorId: staffId, confirm: a.slug });
    await expect(purgeOrganization({ organizationId: a.id, actorId: null, confirm: null })).rejects.toThrow(/Not due/);
    const detached: string[] = [];
    const result = await purgeOrganization({
      organizationId: a.id,
      actorId: staffId,
      confirm: a.slug,
      detachDomains: async (domains) => domains.map((domain) => (detached.push(domain.hostname), { hostname: domain.hostname, ok: true })),
    });
    purgedIds.push(a.id);
    expect(result.tables).toBe(tables.length);
    expect(detached.length).toBeGreaterThan(0);

    const afterA = await countFor(a.id);
    expect(Object.entries(afterA).filter(([, n]) => n > 0)).toEqual([]);
    expect(await db.organization.count({ where: { id: a.id } })).toBe(0);
    expect(await countFor(b.id)).toEqual(beforeB);
    expect(await db.user.count({ where: { id: a.ownerId } })).toBe(1);
    const log = await db.platformAuditLog.findFirst({ where: { action: "org.purged", targetId: a.id } });
    expect(log).not.toBeNull();
  });
});

/**
 * Creates one row in as many tenant tables as possible, filling required fields
 * from the Prisma datamodel. Parents are created before children (repeated passes).
 */
async function fillTenantTables(db: PrismaClient, org: { id: string; brandId: string; ownerId: string }, suffix: string): Promise<string[]> {
  const models = Prisma.dmmf.datamodel.models;
  const enums = new Map(Prisma.dmmf.datamodel.enums.map((item) => [item.name, item.values[0]!.name]));
  const created = new Map<string, string>([["Organization", org.id], ["Brand", org.brandId], ["User", org.ownerId]]);
  const skip = new Set(["Organization", "Brand", "Membership", "Role", "OrgSettings", "Workspace", "AuditLog", "OrganizationModule"]);
  const tenant = models.filter((model) => model.fields.some((field) => field.name === "organizationId") && !skip.has(model.name));
  let counter = 0;
  const done: string[] = [];
  for (let pass = 0; pass < 6; pass += 1) {
    let progress = false;
    for (const model of tenant) {
      if (created.has(model.name)) continue;
      const fkTarget = new Map<string, string>();
      for (const field of model.fields) {
        if (field.kind === "object" && field.relationFromFields?.length) fkTarget.set(field.relationFromFields[0]!, field.type);
      }
      const data: Record<string, unknown> = {};
      let ok = true;
      for (const field of model.fields as Field[]) {
        if (field.kind === "object" || field.isUpdatedAt) continue;
        if (field.name === "organizationId") { data[field.name] = org.id; continue; }
        if (field.name === "brandId") { data[field.name] = org.brandId; continue; }
        const target = fkTarget.get(field.name);
        if (target) {
          const id = created.get(target);
          if (id) data[field.name] = id;
          else if (field.isRequired) ok = false;
          continue;
        }
        if (!field.isRequired || field.hasDefaultValue) continue;
        counter += 1;
        if (field.kind === "enum") data[field.name] = enums.get(field.type);
        else if (field.isList) data[field.name] = [];
        else if (/(^|[a-z])(Id|ById)$/.test(field.name) && field.type === "String") data[field.name] = field.name === "userId" || /ById$|ownerId|actorId/.test(field.name) ? org.ownerId : randomUUID();
        else if (field.type === "String") data[field.name] = `t-${suffix}-${counter}-${randomBytes(3).toString("hex")}`;
        else if (field.type === "Int" || field.type === "BigInt") data[field.name] = 1;
        else if (field.type === "Float" || field.type === "Decimal") data[field.name] = 1;
        else if (field.type === "Boolean") data[field.name] = false;
        else if (field.type === "DateTime") data[field.name] = new Date();
        else if (field.type === "Json") data[field.name] = {};
        else if (field.type === "Bytes") data[field.name] = Buffer.from("x");
        else ok = false;
      }
      if (!ok) continue;
      const delegate = (db as unknown as Record<string, { create: (args: unknown) => Promise<Record<string, unknown>> }>)[
        `${model.name.charAt(0).toLowerCase()}${model.name.slice(1)}`
      ];
      try {
        const row = await delegate!.create({ data });
        created.set(model.name, String(row.id ?? model.name));
        done.push(model.name);
        progress = true;
      } catch {
        // A required parent is missing (or a unique/check constraint): retry on the next pass.
      }
    }
    if (!progress) break;
  }
  return done;
}
