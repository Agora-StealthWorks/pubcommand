import { defineJob } from "@/lib/jobs/types";
import { syncLegacyGmail } from "@/features/ispy/pipeline";

/** Every 3 hours: the legacy iSpy Gmail inboxes and the MarketBeat seed, until every list has its own inbox. */
export const ispyGmailSync = defineJob({
  name: "ispy.gmail-sync",
  description: "Pull new mail from ISpy's legacy Gmail inboxes (and affiliate seeds), then process it.",
  schedule: "41 */3 * * *",
  timeoutMs: 50 * 60_000,
  run: () => syncLegacyGmail(),
});
