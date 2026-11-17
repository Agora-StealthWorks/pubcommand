import { defineJob } from "@/lib/jobs/types";
import { drainBulkQueue } from "@/features/promos/bulk-queue";
import { runBulkJob } from "@/features/promos/insights";

/**
 * Drains Promo Analyzer's bulk re-analysis queue (promo_bulk_jobs). The queue
 * is in the database, so a restart loses nothing; at most two analyses run at
 * once across every server. Stops claiming new work after ten minutes so a run
 * ends before the next slots pile up.
 */
export const promoBulkReanalyze = defineJob({
  name: "promo-studio.bulk-reanalyze",
  description: "Run queued promo re-analyses, two at a time.",
  schedule: "* * * * *",
  timeoutMs: 14 * 60_000,
  async run() {
    return drainBulkQueue({ run: runBulkJob, budgetMs: 10 * 60_000, maxJobs: 40 });
  },
});
