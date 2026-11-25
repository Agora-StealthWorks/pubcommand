import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { provisionOrganization, registerOrganizationMember } from "./provision";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/pubcommand";
process.env.DATABASE_URL = databaseUrl;

describe("organization registration page", () => {
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const suffix = randomBytes(4).toString("hex");
  const email = (name: string) => `${name}-${suffix}@example.com`;
  let orgId = "";
  let planId = "";

  beforeAll(async () => {
    const actor = await db.user.create({ data: { email: email("staff"), passwordHash: null } });
    planId = (await db.plan.create({ data: { key: `reg-${suffix}`, name: "Reg", seatLimit: 3, monthlyPriceCents: 0 } })).id;
    orgId = (await provisionOrganization({ name: "Reg", slug: `reg-${suffix}`, planId, adminEmail: email("owner"), actorId: actor.id, actorEmail: email("staff"), permissionKeys: [] })).organizationId;
  });

  afterAll(async () => {
    if (orgId) await db.organization.deleteMany({ where: { id: orgId } });
    await db.user.deleteMany({ where: { email: { endsWith: `-${suffix}@example.com` } } });
    if (planId) await db.plan.deleteMany({ where: { id: planId } });
    await db.$disconnect();
  });

  it("is closed until the organization turns it on", async () => {
    expect(await registerOrganizationMember({ organizationId: orgId, email: email("a"), name: "A", passwordHash: "h", existingUserId: null })).toEqual({ ok: false, reason: "closed" });
    expect(await db.user.count({ where: { email: email("a") } })).toBe(0);
  });

  it("creates the account and joins as an active basic User, within the seat limit", async () => {
    await db.orgSettings.update({ where: { organizationId: orgId }, data: { registrationEnabled: true } });
    const first = await registerOrganizationMember({ organizationId: orgId, email: email("a"), name: "Ann", passwordHash: "hash", existingUserId: null });
    expect(first).toMatchObject({ ok: true, joined: "new-account" });
    const member = await db.membership.findFirstOrThrow({ where: { organizationId: orgId, userId: first.ok ? first.userId : "" }, include: { role: true, user: true } });
    expect(member).toMatchObject({ status: "ACTIVE", role: { slug: "user" }, user: { name: "Ann", passwordHash: "hash" } });
    // Owner (invited) + Ann + Bob = 3 seats; the next one is refused.
    expect(await registerOrganizationMember({ organizationId: orgId, email: email("b"), name: null, passwordHash: "h", existingUserId: null })).toMatchObject({ ok: true });
    expect(await registerOrganizationMember({ organizationId: orgId, email: email("c"), name: null, passwordHash: "h", existingUserId: null })).toEqual({ ok: false, reason: "no-seats" });
  });

  it("leaves an existing member's role alone and accepts an open invite", async () => {
    const ann = await db.user.findFirstOrThrow({ where: { email: email("a") } });
    expect(await registerOrganizationMember({ organizationId: orgId, email: ann.email, name: null, passwordHash: null, existingUserId: ann.id })).toMatchObject({ ok: true, joined: "already-member" });
    const owner = await db.user.findFirstOrThrow({ where: { email: email("owner") } });
    expect(await registerOrganizationMember({ organizationId: orgId, email: owner.email, name: null, passwordHash: null, existingUserId: owner.id })).toMatchObject({ ok: true, joined: "existing-account" });
    const ownerMember = await db.membership.findFirstOrThrow({ where: { organizationId: orgId, userId: owner.id }, include: { role: true } });
    expect(ownerMember).toMatchObject({ status: "ACTIVE", role: { slug: "owner" } });
  });
});
