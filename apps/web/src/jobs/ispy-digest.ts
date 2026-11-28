import { defineJob } from "@/lib/jobs/types";
import { sendDailyDigest } from "@/features/ispy/trends";

/** Daily 7:20 am ET: yesterday's new promos and reused copy to Slack and/or email. */
export const ispyDigest = defineJob({
  name: "ispy.digest",
  description: "Send ISpy's daily digest (new promos, reused copy) to Slack and/or email.",
  schedule: "20 7 * * *",
  run: () => sendDailyDigest(),
});
