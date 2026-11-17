import { rawPrisma, tenantDb } from "@pubcommand/db";
import { byOrg, trackJobBrands } from "@/features/trackrecord/job-scope";
import { historyDue, marketConnected } from "@/features/trackrecord/prices";
import { callViews, positionViews, refreshCallHistory, refreshPositionHistory } from "@/features/trackrecord/server";
import { defineJob } from "@/lib/jobs/types";

const MAX_HISTORY_PER_BRAND = 200;

/** Fresh quotes for open positions and live calls, and peak/split history for whatever is due (about once a day each). */
export const performancePriceRefresh = defineJob({
  name: "performance.price-refresh",
  description: "Track Record: refresh quotes for open positions and calls, and recompute peaks and splits that are due.",
  schedule: "10,40 9-16 * * 1-5",
  timeoutMs: 20 * 60 * 1000,
  async run({ log }) {
    if (!marketConnected()) return { skipped: "market data not connected" };
    const db = rawPrisma();
    const [positions, calls] = await Promise.all([
      db.trackPosition.findMany({ where: { deletedAt: null }, distinct: ["organizationId", "brandId"], select: { organizationId: true, brandId: true } }),
      db.trackCall.findMany({ where: { deletedAt: null, priceSymbol: { not: null } }, distinct: ["organizationId", "brandId"], select: { organizationId: true, brandId: true } }),
    ]);
    const brands = await trackJobBrands(byOrg([...positions, ...calls]));
    let quoted = 0;
    let peaks = 0;
    let callPeaks = 0;
    let errors = 0;
    for (const brand of brands) {
      const views = await positionViews(brand.organizationId, { brandId: brand.brandId }, { refresh: true });
      quoted += views.filter((v) => v.status !== "CLOSED").length;
      const due = views.filter((v) => v.priceSymbol && historyDue(v.peakCheckedAt, v.status === "CLOSED")).slice(0, MAX_HISTORY_PER_BRAND);
      const history = await refreshPositionHistory(brand.organizationId, due);
      peaks += history.updated;
      errors += history.errors.length;
      const callRows = await tenantDb(brand.organizationId).trackCall.findMany({ where: { brandId: brand.brandId, deletedAt: null, priceSymbol: { not: null } } });
      await callViews(brand.organizationId, callRows, { refresh: true });
      const dueCalls = callRows.filter((c) => c.gainBasis !== "NONE" && historyDue(c.peakCheckedAt, c.gainBasis === "EXIT")).slice(0, MAX_HISTORY_PER_BRAND);
      const callErrors = await refreshCallHistory(brand.organizationId, dueCalls);
      callPeaks += dueCalls.length - callErrors.length;
      errors += callErrors.length;
    }
    log(`brands ${brands.length}`);
    return { brands: brands.length, openPositions: quoted, peaksUpdated: peaks, callPeaksUpdated: callPeaks, errors };
  },
});
