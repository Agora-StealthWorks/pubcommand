import { organizationsWithModule, rawPrisma } from "@pubcommand/db";
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
  return organizationsWithModule(ids, "support");
}
