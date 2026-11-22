import { rawPrisma } from "@pubcommand/db";

/**
 * The admin console's own workspace.
 *
 * Promo Analyzer and VidRipper run in the platform console (admin.<root>) for
 * PubCommand staff. Their code is the org apps' code, which stores everything in
 * tenant tables, so the console uses one internal organization, "pubcommand-console",
 * created on first use. Nobody is a member of it (only the platform super admin
 * could open it on its own host). Everything taught there learns up into the
 * Master Brain like any other organization.
 */
export const CONSOLE_ORG_SLUG = "pubcommand-console";
export const CONSOLE_ORG_NAME = "PubCommand Console";
export const CONSOLE_BRAND_NAME = "PubCommand";

/** Apps the console workspace always has, whatever its plan says. */
export const CONSOLE_MODULE_IDS = ["promo-studio", "intel", "knowledge", "pubsetup"] as const;

let ensured: Promise<string> | null = null;

/** The console organization's id, creating it (and its brand) the first time. */
export function ensureConsoleOrganization(): Promise<string> {
  ensured ??= createIfMissing().catch((error: unknown) => {
    ensured = null;
    throw error;
  });
  return ensured;
}

async function createIfMissing(): Promise<string> {
  const db = rawPrisma();
  const existing = await db.organization.findUnique({ where: { slug: CONSOLE_ORG_SLUG }, select: { id: true, deletedAt: true } });
  const organizationId =
    existing?.id ??
    (await db.$transaction(async (tx) => {
      const plan =
        (await tx.plan.findFirst({ where: { archivedAt: null }, orderBy: { seatLimit: "desc" } })) ??
        (await tx.plan.findFirst({ orderBy: { seatLimit: "desc" } }));
      if (!plan) throw new Error("No plan exists yet, so the console workspace cannot be created.");
      const organization = await tx.organization.create({ data: { name: CONSOLE_ORG_NAME, slug: CONSOLE_ORG_SLUG, planId: plan.id, seatLimit: 1 } });
      await tx.orgSettings.create({ data: { organizationId: organization.id, displayName: CONSOLE_ORG_NAME, timezone: "America/New_York" } });
      const brand = await tx.brand.create({ data: { organizationId: organization.id, name: CONSOLE_BRAND_NAME, slug: "pubcommand", niche: "finance" } });
      await tx.workspace.create({ data: { organizationId: organization.id, brandId: brand.id, name: "General", slug: "general" } });
      return organization.id;
    }));
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
    // The console workspace must never be soft-deleted or suspended out from under staff.
    if (existing?.deletedAt) await tx.organization.update({ where: { id: organizationId }, data: { deletedAt: null, deletedById: null } });
    for (const moduleId of CONSOLE_MODULE_IDS) {
      await tx.organizationAppAccess.upsert({
        where: { orgId_moduleId: { orgId: organizationId, moduleId } },
        create: { orgId: organizationId, moduleId, access: "ALLOWED" },
        update: { access: "ALLOWED" },
      });
      await tx.organizationModule.upsert({
        where: { organizationId_moduleId: { organizationId, moduleId } },
        create: { organizationId, moduleId, enabled: true },
        update: { enabled: true },
      });
    }
    const brands = await tx.brand.count({ where: { organizationId } });
    if (brands === 0) {
      const brand = await tx.brand.create({ data: { organizationId, name: CONSOLE_BRAND_NAME, slug: "pubcommand", niche: "finance" } });
      await tx.workspace.create({ data: { organizationId, brandId: brand.id, name: "General", slug: "general" } });
    }
  });
  return organizationId;
}
