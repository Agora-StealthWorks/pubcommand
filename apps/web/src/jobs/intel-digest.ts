import { defineJob } from "@/lib/jobs/types";
import { loadBrand } from "@/features/intel/gmail";
import { digestBrands, lastCompleteWeek, sendBrandDigest } from "@/features/intel/scheduled";
import { isoDay } from "../../../../modules/intel/index";

/** Monday 8:05 ET, after intel.radar: post last week's radar to each brand's Slack webhook and/or email list. */
export const intelDigest = defineJob({
  name: "intel.digest",
  description: "Send the weekly Promo Radar digest to Slack and/or email for brands that turned it on.",
  schedule: "5 8 * * 1",
  timeoutMs: 30 * 60_000,
  async run({ log }) {
    const week = lastCompleteWeek();
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    for (const { organizationId, brandId } of await digestBrands()) {
      const brand = await loadBrand(organizationId, brandId);
      if (!brand) continue;
      const outcome = await sendBrandDigest({ organizationId, brand, week });
      if (outcome.sent) sent += 1;
      else if (outcome.skipped) skipped += 1;
      else failed += 1;
      if (outcome.error) log(`brand ${brandId}: ${outcome.error}`);
    }
    return { week: isoDay(week), sent, skipped, failed };
  },
});
