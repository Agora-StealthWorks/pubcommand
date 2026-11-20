import { rawPrisma, tenantDb } from "@pubcommand/db";
import { defineJob } from "@/lib/jobs/types";
import { runSheetSync } from "@/features/promos/sheets";
import { syncDue } from "../../../../modules/promo-studio/sheets";

/** Pulls each brand's Google Sheet of promo results when its interval has passed. */
export const promoSheetsSync = defineJob({
  name: "promo-studio.sheets-sync",
  description: "Sync promo performance from each brand's Google Sheet.",
  schedule: "7 * * * *",
  async run() {
    const now = new Date();
    const orgs = await rawPrisma().organization.findMany({ where: { deletedAt: null }, select: { id: true } });
    let checked = 0;
    let imported = 0;
    let unchanged = 0;
    let failed = 0;
    for (const org of orgs) {
      const configs = await tenantDb(org.id).promoSheetSync.findMany({ where: { enabled: true } });
      for (const config of configs) {
        checked += 1;
        if (!syncDue(config, now)) continue;
        const result = await runSheetSync({ organizationId: org.id, brandId: config.brandId, actorId: null });
        if (result.status === "imported") imported += 1;
        else if (result.status === "unchanged") unchanged += 1;
        else failed += 1;
      }
    }
    return { checked, imported, unchanged, failed };
  },
});
