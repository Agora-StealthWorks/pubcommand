import { defineJob } from "@/lib/jobs/types";
import { buildLastWeek } from "@/features/ispy/trends";
import { readIspySettings } from "@/features/ispy/settings";

/** Mondays 5:40 am ET: last week's niche-wide trends for both feeds (one short AI paragraph each). */
export const ispyTrends = defineJob({
  name: "ispy.trends",
  description: "Build last week's niche-wide ISpy trends for FinPub and Health and teach them to the Brains.",
  schedule: "40 5 * * 1",
  timeoutMs: 30 * 60_000,
  async run() {
    if (!(await readIspySettings()).weeklyTrends) return { skipped: "weekly trends are off" };
    return buildLastWeek();
  },
});
