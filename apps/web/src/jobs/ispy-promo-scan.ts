import { defineJob } from "@/lib/jobs/types";
import { ispyDb } from "@/features/ispy/db";
import { scanPendingPromos } from "@/features/ispy/promos";

/** Hourly: resolve landing pages for emails still waiting; at 3 am retry the ones that failed. */
export const ispyPromoScan = defineJob({
  name: "ispy.promo-scan",
  description: "Follow pending emails' links to their landing pages and match them to promos (nightly retry of failures).",
  schedule: "23 * * * *",
  timeoutMs: 50 * 60_000,
  async run({ scheduledFor }) {
    if (scheduledFor.getHours() === 3) await ispyDb((tx) => tx.ispyEmail.updateMany({ where: { promoScanStatus: "FAILED" }, data: { promoScanStatus: "PENDING" } }));
    return scanPendingPromos(200);
  },
});
