import { rawPrisma } from "@pubcommand/db";
import { defineJob } from "@/lib/jobs/types";

/** Keeps the job history short: drops finished runs older than 30 days. */
export const jobRunsCleanup = defineJob({
  name: "platform.job-runs-cleanup",
  description: "Delete job history older than 30 days.",
  schedule: "15 3 * * *",
  async run() {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const { count } = await rawPrisma().jobRun.deleteMany({ where: { startedAt: { lt: cutoff }, status: { not: "running" } } });
    return { deleted: count };
  },
});
