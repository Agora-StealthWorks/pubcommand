import { defineJob } from "@/lib/jobs/types";
import { extractTouched, syncAllInboxes } from "@/features/intel/scheduled";

/** Every three hours: pull new competitor mail from each connected Gmail inbox, then extract it. */
export const intelGmailSync = defineJob({
  name: "intel.gmail-sync",
  description: "Pull new competitor email from connected Gmail inboxes, then run the AI extraction on it.",
  schedule: "17 */3 * * *",
  timeoutMs: 45 * 60_000,
  async run({ log }) {
    const synced = await syncAllInboxes();
    if ("skipped" in synced) return { skipped: synced.skipped };
    await extractTouched(synced.touched);
    const failed = synced.outcomes.filter((outcome) => outcome.error).length;
    if (failed) log(`${failed} inbox(es) failed to sync; see Intel → Gmail for the reason.`);
    return {
      inboxes: synced.outcomes.length,
      added: synced.outcomes.reduce((sum, outcome) => sum + outcome.added, 0),
      failed,
      brandsWithNewMail: synced.touched.length,
    };
  },
});
