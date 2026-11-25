import { defineJob } from "@/lib/jobs/types";
import { captureActivities } from "@/features/usage/capture";
import { runInsights } from "@/features/usage/insights";
import { syncReference } from "@/features/usage/reference";

/** Operations Brain: yesterday's daily read, and on Mondays last week's strategy note. */
export const usageInsights = defineJob({
  name: "usage.insights",
  description: "Write the Operations Brain's daily read (and the weekly strategy note on Mondays) from how people used the app.",
  schedule: "35 2 * * *",
  timeoutMs: 20 * 60_000,
  async run(ctx) {
    // Catch up first so the note sees everything up to midnight.
    await captureActivities({ log: ctx.log });
    const reference = await syncReference();
    return { ...(await runInsights(ctx.scheduledFor)), reference };
  },
});
