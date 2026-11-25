import { defineJob } from "@/lib/jobs/types";
import { captureActivities } from "@/features/usage/capture";

/** What people did and made: organization activity with snapshots of the copy (Usage → Activity). */
export const usageCapture = defineJob({
  name: "usage.capture",
  description: "Record what people did and made in every organization, with a text snapshot of the content.",
  schedule: "*/10 * * * *",
  async run(ctx) {
    return captureActivities({ log: ctx.log });
  },
});
