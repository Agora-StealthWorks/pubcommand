import { rawPrisma } from "@pubcommand/db";
import { syncFromPubsetup } from "@/features/support/pubsetup-sync";
import { defineJob } from "@/lib/jobs/types";

/** Keep publication, editor and price records in step with Publication Setup. Idempotent (hash-compared). */
export const supportPubsetupSync = defineJob({
  name: "support.pubsetup-sync",
  description: "Support Knowledge: refresh publication, editor and price records from Publication Setup.",
  schedule: "35 * * * *",
  async run() {
    const settings = await rawPrisma().supportSettings.findMany({ where: { pubsetupSync: true }, select: { organizationId: true, brandId: true } });
    const entitled = await entitledOrgs(settings.map((s) => s.organizationId));
    const totals = { brands: 0, created: 0, updated: 0, unchanged: 0, locked: 0, errors: 0 };
    for (const row of settings) {
      if (!entitled.has(row.organizationId)) continue;
      const result = await syncFromPubsetup(row.organizationId, row.brandId, null);
      totals.brands += 1;
      totals.created += result.created;
      totals.updated += result.updated;
      totals.unchanged += result.unchanged;
      totals.locked += result.locked;
      totals.errors += result.errors;
    }
    return totals;
  },
});

/** Organizations whose plan includes Support Knowledge and have not switched it off. */
export async function entitledOrgs(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const orgs = await rawPrisma().organization.findMany({
    where: { id: { in: [...new Set(ids)] }, suspendedAt: null },
    select: { id: true, plan: { select: { modules: { select: { moduleId: true } } } }, modules: { select: { moduleId: true, enabled: true } } },
  });
  return new Set(orgs.filter((o) => o.plan.modules.some((m) => m.moduleId === "support") && !o.modules.some((m) => m.moduleId === "support" && !m.enabled)).map((o) => o.id));
}
