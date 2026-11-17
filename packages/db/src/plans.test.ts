import { randomBytes } from "node:crypto";
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { UNLIMITED_PLAN_LIMIT } from "@pubcommand/core";
import { provisionOrganization } from "./provision";
import { DEFAULT_PLANS, ensureDefaultPlans, insertPlanIfAbsent } from "./plans";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/pubcommand";
process.env.DATABASE_URL = databaseUrl;

describe("default plans", () => {
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const suffix = randomBytes(4).toString("hex");
  const actorEmail = `plan-actor-${suffix}@example.com`;
  const adminEmail = `plan-admin-${suffix}@example.com`;
  const scratchKey = `scratch-${suffix}`;
  let actorId = "";
  const organizationIds: string[] = [];

  beforeAll(async () => {
    execSync("pnpm exec prisma migrate deploy --schema prisma/schema", {
      cwd: new URL("..", import.meta.url).pathname,
      env: process.env,
      stdio: "inherit",
    });
    const actor = await db.user.create({ data: { email: actorEmail, passwordHash: null } });
    actorId = actor.id;
  });

  afterAll(async () => {
    if (organizationIds.length > 0) await db.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await db.user.deleteMany({ where: { email: { in: [actorEmail, adminEmail, `internal-${suffix}@example.com`] } } });
    await db.plan.deleteMany({ where: { key: scratchKey } });
    await db.$disconnect();
  });

  it("creates a missing plan once, leaves later edits, and can provision an organization", async () => {
    const seed = {
      key: scratchKey,
      name: "Scratch",
      seatLimit: 3,
      brandLimit: 1,
      workspaceLimit: 1,
      monthlyPriceCents: 0,
      moduleIds: ["settings", "knowledge"],
    };
    expect(await insertPlanIfAbsent(seed)).toBe("created");
    await db.plan.update({
      where: { key: scratchKey },
      data: { name: "Scratch edited", seatLimit: 9, monthlyPriceCents: 2500, brandLimit: 4 },
    });
    await db.planModule.deleteMany({ where: { plan: { key: scratchKey }, moduleId: "knowledge" } });
    expect(await insertPlanIfAbsent(seed)).toBe("kept");
    const kept = await db.plan.findUniqueOrThrow({ where: { key: scratchKey }, include: { modules: true } });
    expect(kept.name).toBe("Scratch edited");
    expect(kept.seatLimit).toBe(9);
    expect(kept.brandLimit).toBe(4);
    expect(kept.monthlyPriceCents).toBe(2500);
    expect(kept.modules.map((row) => row.moduleId)).toEqual(["settings"]);

    const created = await provisionOrganization({
      name: "Scratch Desk",
      slug: `scratch-${suffix}`,
      planId: kept.id,
      adminEmail,
      actorId,
      actorEmail,
      permissionKeys: ["settings.manage"],
    });
    organizationIds.push(created.organizationId);
    expect(created.slug).toBe(`scratch-${suffix}`);
    const organization = await db.organization.findUniqueOrThrow({ where: { id: created.organizationId } });
    expect(organization.planId).toBe(kept.id);
    expect(organization.seatLimit).toBe(9);
  });

  it("seeds Starter, Pro, Enterprise, and Internal without duplicating or clobbering", async () => {
    const keys = DEFAULT_PLANS.map((plan) => plan.key);
    const before = await db.plan.findMany({ where: { key: { in: keys } } });
    const first = await ensureDefaultPlans();
    const after = await db.plan.findMany({ where: { key: { in: keys } }, include: { modules: true } });
    expect(after.map((plan) => plan.key).sort()).toEqual([...keys].sort());
    expect(first.created.every((key) => !before.some((plan) => plan.key === key))).toBe(true);
    for (const row of before) {
      const next = after.find((plan) => plan.key === row.key);
      expect(next).toMatchObject({
        name: row.name,
        seatLimit: row.seatLimit,
        brandLimit: row.brandLimit,
        workspaceLimit: row.workspaceLimit,
        monthlyPriceCents: row.monthlyPriceCents,
      });
    }
    for (const key of first.created) {
      const definition = DEFAULT_PLANS.find((plan) => plan.key === key);
      const row = after.find((plan) => plan.key === key);
      expect(row?.name).toBe(definition?.name);
      expect(row?.modules.length).toBeGreaterThan(0);
    }
    expect((await ensureDefaultPlans()).created).toEqual([]);

    const internal = after.find((plan) => plan.key === "internal");
    expect(internal).toBeTruthy();
    if (!internal) return;
    if (first.created.includes("internal")) {
      expect(internal.name).toBe("Internal (unlimited)");
      expect(internal.seatLimit).toBe(UNLIMITED_PLAN_LIMIT);
      expect(internal.brandLimit).toBe(UNLIMITED_PLAN_LIMIT);
      expect(internal.workspaceLimit).toBe(UNLIMITED_PLAN_LIMIT);
    }
    const previousArchive = internal.archivedAt;
    if (previousArchive) await db.plan.update({ where: { id: internal.id }, data: { archivedAt: null } });
    try {
      const created = await provisionOrganization({
        name: "Internal Desk",
        slug: `internal-${suffix}`,
        planId: internal.id,
        adminEmail: `internal-${suffix}@example.com`,
        actorId,
        actorEmail,
        permissionKeys: ["settings.manage"],
      });
      organizationIds.push(created.organizationId);
      expect(created.organizationId).toBeTruthy();
    } finally {
      if (previousArchive) await db.plan.update({ where: { id: internal.id }, data: { archivedAt: previousArchive } });
    }
  });
});
