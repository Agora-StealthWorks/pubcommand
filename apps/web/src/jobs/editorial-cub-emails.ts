import { rawPrisma } from "@pubcommand/db";
import { defineJob } from "@/lib/jobs/types";
import { runCubTickForOrg } from "@/features/calendar/cub-emails";

/**
 * CUB Collector emails: the 9:05 am ET reminder on the business day before a
 * deadline, and "revisions ready" to whoever started the round once it passes.
 * Idempotent through the rounds' stamp columns.
 */
export const editorialCubEmails = defineJob({
  name: "editorial.cub-emails",
  description: "Send CUB review reminders and post-deadline 'revisions ready' emails.",
  schedule: "*/15 * * * *",
  async run({ scheduledFor }) {
    const orgs = await rawPrisma().organization.findMany({ where: { suspendedAt: null }, select: { id: true } });
    const total = { organizations: orgs.length, reminders: 0, completions: 0, skipped: 0, failed: 0 };
    const now = new Date(Math.max(Date.now(), scheduledFor.getTime()));
    for (const { id } of orgs) {
      const counts = await runCubTickForOrg(id, now);
      total.reminders += counts.reminders;
      total.completions += counts.completions;
      total.skipped += counts.skipped;
      total.failed += counts.failed;
    }
    return total;
  },
});
