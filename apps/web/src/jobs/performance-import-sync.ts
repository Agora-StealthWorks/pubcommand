import { rawPrisma, tenantDb } from "@pubcommand/db";
import { byOrg, trackJobBrands } from "@/features/trackrecord/job-scope";
import { afterPositionsChanged } from "@/features/trackrecord/server";
import { syncSource } from "@/features/trackrecord/sources";
import { defineJob } from "@/lib/jobs/types";

/** Re-sync connected Google Sheets and Airtable tables. Only adds and closes; never deletes or rewrites a trade. */
export const performanceImportSync = defineJob({
  name: "performance.import-sync",
  description: "Track Record: re-sync recommendations from connected Google Sheets and Airtable tables.",
  schedule: "20 * * * *",
  timeoutMs: 20 * 60 * 1000,
  async run() {
    const rows = await rawPrisma().trackImportSource.findMany({ where: { deletedAt: null, autoSync: true }, select: { organizationId: true, brandId: true } });
    const brands = await trackJobBrands(byOrg(rows));
    let synced = 0;
    let failed = 0;
    let created = 0;
    let closed = 0;
    for (const brand of brands) {
      const sources = await tenantDb(brand.organizationId).trackImportSource.findMany({ where: { brandId: brand.brandId, deletedAt: null, autoSync: true } });
      for (const source of sources) {
        const scope = { organizationId: brand.organizationId, brandId: brand.brandId, actorId: source.createdById };
        const outcome = await syncSource(scope, source, { apply: true });
        if (!outcome.ok) {
          failed += 1;
          continue;
        }
        synced += 1;
        if (outcome.applied) {
          created += outcome.applied.created;
          closed += outcome.applied.closed;
          await afterPositionsChanged(scope, outcome.applied.portfolioIds, outcome.applied.positionIds.slice(0, 200));
        }
      }
    }
    return { sources: synced + failed, synced, failed, created, closed };
  },
});
