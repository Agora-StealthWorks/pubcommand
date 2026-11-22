import { randomBytes } from "node:crypto";
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { MEMBER_PASSWORD_MESSAGES } from "@pubcommand/core";
import { changeOwnPassword, setMemberPassword, updateOwnName } from "./passwords";
import { provisionOrganization } from "./provision";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/pubcommand";
process.env.DATABASE_URL = databaseUrl;

const HASH = "$2b$12$passwords.test.hash.value.abcdef";
const SECRET_MARKER = "passwords.test.hash";

describe("org passwords", () => {
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const suffix = randomBytes(4).toString("hex");
  const email = (name: string) => `pw-${name}-${suffix}@example.com`;
  const ids: Record<string, string> = {};
  const orgIds: string[] = [];
  let planId = "";

  const session = (userId: string, id: string) =>
    db.session.create({ data: { id: `${id}-${suffix}`, userId, expiresAt: new Date(Date.now() + 86_400_000) } });

  beforeAll(async () => {
    execSync("pnpm exec prisma migrate deploy --schema prisma/schema", {
      cwd: new URL("..", import.meta.url).pathname,
      env: process.env,
      stdio: "inherit",
    });
    const plan = await db.plan.create({
      data: { key: `pw-${suffix}`, name: "Passwords", seatLimit: 9, brandLimit: 2, workspaceLimit: 2, monthlyPriceCents: 0 },
    });
    planId = plan.id;
    const creator = await db.user.create({ data: { email: email("creator"), passwordHash: null } });
    ids.creator = creator.id;
    for (const name of ["one", "two"]) {
      const org = await provisionOrganization({
        name: `Passwords ${name}`,
        slug: `pw-${name}-${suffix}`,
        planId,
        adminEmail: email(`admin-${name}`),
        actorId: creator.id,
        actorEmail: email("creator"),
        permissionKeys: ["settings.manage", "settings.users.manage"],
      });
      orgIds.push(org.organizationId);
      ids[`admin-${name}`] = org.userId;
    }
    const role = await db.role.findFirstOrThrow({ where: { organizationId: orgIds[0], slug: "user" } });
    for (const name of ["member", "both", "staff"]) {
      const user = await db.user.create({ data: { email: email(name), passwordHash: null } });
      ids[name] = user.id;
      await db.membership.create({ data: { organizationId: orgIds[0]!, userId: user.id, roleId: role.id, status: "ACTIVE" } });
    }
    const otherRole = await db.role.findFirstOrThrow({ where: { organizationId: orgIds[1], slug: "user" } });
    await db.membership.create({ data: { organizationId: orgIds[1]!, userId: ids.both!, roleId: otherRole.id, status: "ACTIVE" } });
    await db.platformStaff.create({ data: { userId: ids.staff!, role: "SUPPORT" } });
  });

  afterAll(async () => {
    await db.platformAuditLog.deleteMany({ where: { targetId: { in: Object.values(ids) } } }).catch(() => undefined);
    await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    await db.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
    if (planId) await db.plan.deleteMany({ where: { id: planId } });
    await db.$disconnect();
  });

  const base = () => ({ organizationId: orgIds[0]!, actorId: ids["admin-one"]!, actorCanManageUsers: true, impersonating: false, passwordHash: HASH });

  it("lets an admin set a single-org member's password and signs them out everywhere", async () => {
    await session(ids.member!, "m1");
    await session(ids.member!, "m2");
    const result = await setMemberPassword({ ...base(), targetUserId: ids.member! });
    expect(result.sessionsSignedOut).toBe(2);
    expect((await db.user.findUniqueOrThrow({ where: { id: ids.member! } })).passwordHash).toBe(HASH);
    expect(await db.session.count({ where: { userId: ids.member! } })).toBe(0);
    const audits = await db.auditLog.findMany({ where: { organizationId: orgIds[0], targetId: ids.member!, action: "member.password.set" } });
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toContain(SECRET_MARKER);
    const platform = await db.platformAuditLog.findMany({ where: { targetId: ids.member!, action: "member.password.set" } });
    expect(platform).toHaveLength(1);
    expect(JSON.stringify(platform)).not.toContain(SECRET_MARKER);
  });

  it("refuses self, staff, other-org members, outsiders and non-admins", async () => {
    await expect(setMemberPassword({ ...base(), targetUserId: ids["admin-one"]! })).rejects.toThrow(MEMBER_PASSWORD_MESSAGES.self);
    await expect(setMemberPassword({ ...base(), targetUserId: ids.staff! })).rejects.toThrow(MEMBER_PASSWORD_MESSAGES.staff);
    await expect(setMemberPassword({ ...base(), targetUserId: ids.both! })).rejects.toThrow(MEMBER_PASSWORD_MESSAGES.otherOrganization);
    await expect(setMemberPassword({ ...base(), targetUserId: ids["admin-two"]! })).rejects.toThrow(MEMBER_PASSWORD_MESSAGES.notMember);
    await expect(setMemberPassword({ ...base(), actorCanManageUsers: false, targetUserId: ids.member! })).rejects.toThrow(MEMBER_PASSWORD_MESSAGES.denied);
    for (const name of ["staff", "both"]) {
      expect((await db.user.findUniqueOrThrow({ where: { id: ids[name]! } })).passwordHash).toBeNull();
    }
  });

  it("changing your own password keeps this session and ends the others", async () => {
    const keep = await session(ids["admin-one"]!, "keep");
    await session(ids["admin-one"]!, "other");
    const result = await changeOwnPassword({ userId: ids["admin-one"]!, passwordHash: HASH, keepSessionId: keep.id, organizationId: orgIds[0]!, firstPassword: true });
    expect(result.sessionsSignedOut).toBe(1);
    expect((await db.session.findMany({ where: { userId: ids["admin-one"]! } })).map((row) => row.id)).toEqual([keep.id]);
    const audit = await db.auditLog.findFirstOrThrow({ where: { organizationId: orgIds[0], targetId: ids["admin-one"]!, action: "account.password.created" } });
    expect(JSON.stringify(audit)).not.toContain(SECRET_MARKER);
  });

  it("updates your own display name", async () => {
    expect(await updateOwnName({ userId: ids.member!, name: "  Pat   Example ", organizationId: orgIds[0]! })).toBe("Pat Example");
    expect((await db.user.findUniqueOrThrow({ where: { id: ids.member! } })).name).toBe("Pat Example");
    await expect(updateOwnName({ userId: ids.member!, name: "x".repeat(81), organizationId: null })).rejects.toThrow(/shorter/);
  });
});
