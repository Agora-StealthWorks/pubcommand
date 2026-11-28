import { defineJob } from "@/lib/jobs/types";
import { catchUpCopies, markSilentInboxes, pollMachineMail } from "@/features/ispy/pipeline";
import { readIspySettings } from "@/features/ispy/settings";

/** Every 15 minutes: pull MachineMail inboxes (the webhook is the fast path), then refresh copy notes. */
export const ispyInboxPoll = defineJob({
  name: "ispy.inbox-poll",
  description: "Pull new mail from ISpy's MachineMail inboxes, then refresh copies whose sends changed and mark silent inboxes.",
  schedule: "*/15 * * * *",
  timeoutMs: 14 * 60_000,
  async run() {
    const polled = await pollMachineMail();
    const notes = await catchUpCopies();
    const silent = await markSilentInboxes((await readIspySettings()).silenceDays);
    return { ...polled, ...notes, silent };
  },
});
