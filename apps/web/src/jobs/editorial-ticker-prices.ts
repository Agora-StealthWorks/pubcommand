import { rawPrisma, tenantDb } from "@pubcommand/db";
import { defineJob } from "@/lib/jobs/types";
import { marketConfigured, refreshTickerPrices, showsTickers } from "@/features/calendar/tickers";

/** Daily prices for tickers mentioned in editorial, finance brands only. */
export const editorialTickerPrices = defineJob({
  name: "editorial.ticker-prices",
  description: "Refresh prices for tickers mentioned in editorial issues (finance brands).",
  schedule: "41 18 * * 1-5",
  async run() {
    if (!marketConfigured()) return { skipped: "market data not configured" };
    const orgs = await rawPrisma().organization.findMany({ where: { suspendedAt: null }, select: { id: true } });
    const total = { brands: 0, pairs: 0, priced: 0, failed: 0 };
    for (const { id } of orgs) {
      const brands = await tenantDb(id).brand.findMany({ select: { id: true, name: true, niche: true, audience: true, complianceNotes: true } });
      for (const brand of brands.filter(showsTickers)) {
        total.brands += 1;
        const result = await refreshTickerPrices(id, brand.id);
        total.pairs += result.pairs;
        total.priced += result.priced;
        total.failed += result.failed;
      }
    }
    return total;
  },
});
