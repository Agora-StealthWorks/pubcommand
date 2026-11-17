import { defineJob } from "@/lib/jobs/types";
import { organizationsWithReminders, runRemindersForOrg } from "@/features/funnels/emails";

/**
 * Funnel reminder emails: a set time before each live session (or the start of
 * a fixed-date funnel), to every email opt-in who has not unsubscribed. Runs
 * every 5 minutes; each send is claimed under a unique key first, so a retry or
 * a second server never sends twice. At most 2,000 emails per run.
 */
export const funnelsReminders = defineJob({
  name: "funnels.reminders",
  description: "Send funnel reminder emails before each live session.",
  schedule: "*/5 * * * *",
  timeoutMs: 10 * 60_000,
  async run({ scheduledFor }) {
    const now = new Date(Math.max(Date.now(), scheduledFor.getTime()));
    const totals = { organizations: 0, funnels: 0, due: 0, sent: 0, logged: 0, failed: 0 };
    let budget = 2000;
    for (const org of await organizationsWithReminders()) {
      if (budget <= 0) break;
      const result = await runRemindersForOrg(org.id, org.slug, now, budget);
      if (result.funnels) totals.organizations += 1;
      totals.funnels += result.funnels;
      totals.due += result.due;
      totals.sent += result.sent;
      totals.logged += result.logged;
      totals.failed += result.failed;
      budget -= result.sent + result.logged + result.failed;
    }
    return totals;
  },
});
