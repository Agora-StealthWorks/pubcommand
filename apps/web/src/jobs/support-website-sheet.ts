import { rawPrisma, tenantDb } from "@pubcommand/db";
import { importSheet } from "@/features/support/website";
import { defineJob } from "@/lib/jobs/types";
import { entitledOrgs } from "./support-pubsetup-sync";

/** Re-import each brand's linked website sheet. Locked (edited here) pages are never overwritten. */
export const supportWebsiteSheet = defineJob({
  name: "support.website-sheet",
  description: "Support Knowledge: re-import the website directory from each brand's linked Google Sheet.",
  schedule: "50 * * * *",
  async run() {
    const rows = await rawPrisma().supportSettings.findMany({ where: { siteSheetSync: true, siteSheetUrl: { not: null } }, select: { organizationId: true, brandId: true, siteSheetUrl: true } });
    const entitled = await entitledOrgs(rows.map((r) => r.organizationId));
    const totals = { sheets: 0, created: 0, updated: 0, locked: 0, failed: 0 };
    for (const row of rows) {
      if (!entitled.has(row.organizationId) || !row.siteSheetUrl) continue;
      const result = await importSheet({ organizationId: row.organizationId, brandId: row.brandId, actorId: null }, row.siteSheetUrl);
      const db = tenantDb(row.organizationId);
      if ("error" in result) {
        totals.failed += 1;
        await db.supportSettings.updateMany({ where: { brandId: row.brandId }, data: { lastSheetSyncAt: new Date(), lastSheetResult: { error: result.error } } });
        continue;
      }
      totals.sheets += 1;
      totals.created += result.created;
      totals.updated += result.updated;
      totals.locked += result.locked;
      await db.supportSettings.updateMany({ where: { brandId: row.brandId }, data: { lastSheetSyncAt: new Date(), lastSheetResult: { created: result.created, updated: result.updated, unchanged: result.unchanged, locked: result.locked, invalid: result.invalid.length } } });
    }
    return totals;
  },
});
