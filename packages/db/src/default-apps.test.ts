import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { provisionOrganization } from "./provision";
import { readDefaultAppIds, saveDefaultAppIds } from "./platform-settings";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/pubcommand";
process.env.DATABASE_URL = databaseUrl;

describe("default apps for new organizations", () => {
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const suffix = randomBytes(4).toString("hex");
  const emails = [`owner-${suffix}@example.com`, `staff-${suffix}@example.com`];
  const orgIds: string[] = [];
  let actorId = "";
  let planId = "";

  beforeAll(async () => {
    actorId = (await db.user.create({ data: { email: emails[1]!, passwordHash: null } })).id;
    planId = (await db.plan.create({ data: { key: `defapps-${suffix}`, name: "Def", seatLimit: 2, monthlyPriceCents: 0 } })).id;
    await db.planModule.createMany({ data: [{ planId, moduleId: "knowledge" }, { planId, moduleId: "editorial" }] });
  });

  afterAll(async () => {
    await db.platformSetting.deleteMany({ where: { key: "default_apps" } });
    if (orgIds.length) await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    await db.user.deleteMany({ where: { email: { in: emails } } });
    await db.plan.deleteMany({ where: { id: planId } });
    await db.$disconnect();
  });

  const create = async (slug: string) => {
    const created = await provisionOrganization({
      name: "Default Apps",
      slug,
      planId,
      adminEmail: emails[0]!,
      actorId,
      actorEmail: emails[1]!,
      permissionKeys: ["settings.manage"],
      catalogModuleIds: ["knowledge", "editorial", "funnels", "settings"],
    });
    orgIds.push(created.organizationId);
    const rows = await db.organizationModule.findMany({ where: { organizationId: created.organizationId } });
    return Object.fromEntries(rows.map((row) => [row.moduleId, row.enabled]));
  };

  it("turns every plan app on when no default is saved", async () => {
    await db.platformSetting.deleteMany({ where: { key: "default_apps" } });
    expect(await readDefaultAppIds()).toBeNull();
    expect(await create(`defa-${suffix}`)).toEqual({ knowledge: true, editorial: true, settings: true });
  });

  it("starts apps outside the saved default switched off, settings always on", async () => {
    const saved = await saveDefaultAppIds({ actorId, moduleIds: ["knowledge", "made-up"], allowedModuleIds: ["knowledge", "editorial", "funnels"] });
    expect(saved).toEqual(["knowledge"]);
    expect(await create(`defb-${suffix}`)).toEqual({ knowledge: true, editorial: false, funnels: false, settings: true });
  });
});
