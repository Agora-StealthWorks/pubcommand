import { rawPrisma } from "@pubcommand/db";
import { byOrg, trackJobBrands } from "@/features/trackrecord/job-scope";
import { buildWeeklyReport, reportSettings, sendWeeklyReport } from "@/features/trackrecord/reports";
import { defineJob } from "@/lib/jobs/types";

/** The Friday performance email: built for every brand that turned it on, sent when auto-send is on. Never sent twice. */
export const performanceWeeklyReport = defineJob({
  name: "performance.weekly-report",
  description: "Track Record: build the Friday weekly performance report and email it to the chosen team members.",
  schedule: "30 16 * * 5",
  async run() {
    const rows = await rawPrisma().trackReportSettings.findMany({ where: { enabled: true }, select: { organizationId: true, brandId: true } });
    const brands = await trackJobBrands(byOrg(rows));
    let built = 0;
    let sent = 0;
    let notSent = 0;
    for (const brand of brands) {
      const scope = { organizationId: brand.organizationId, brandId: brand.brandId, actorId: null };
      const settings = await reportSettings(scope);
      if (!settings?.enabled) continue;
      const report = await buildWeeklyReport(scope, { brandName: brand.brandName, orgSlug: brand.orgSlug });
      built += 1;
      if (!settings.autoSend || report.status === "SENT") continue;
      const result = await sendWeeklyReport(scope, report);
      if (result.status === "SENT") sent += 1;
      else notSent += 1;
    }
    return { brands: brands.length, built, sent, notSent };
  },
});
