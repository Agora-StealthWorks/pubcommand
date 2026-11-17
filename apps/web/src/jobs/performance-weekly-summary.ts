import { rawPrisma } from "@pubcommand/db";
import { byOrg, trackJobBrands } from "@/features/trackrecord/job-scope";
import { listPortfolios, teachWeeklySummary } from "@/features/trackrecord/server";
import { defineJob } from "@/lib/jobs/types";

/** The weekly aggregate Brain note per portfolio, every Friday after the close (it also refreshes on activity). */
export const performanceWeeklySummary = defineJob({
  name: "performance.weekly-summary",
  description: "Track Record: teach each brand's Brain this week's aggregate summary per portfolio.",
  schedule: "15 17 * * 5",
  async run() {
    const rows = await rawPrisma().trackPortfolio.findMany({ where: { deletedAt: null }, distinct: ["organizationId", "brandId"], select: { organizationId: true, brandId: true } });
    const brands = await trackJobBrands(byOrg(rows));
    let notes = 0;
    for (const brand of brands) {
      const scope = { organizationId: brand.organizationId, brandId: brand.brandId, actorId: null };
      for (const portfolio of await listPortfolios(scope)) {
        if (await teachWeeklySummary(scope, portfolio.id)) notes += 1;
      }
    }
    return { brands: brands.length, notes };
  },
});
