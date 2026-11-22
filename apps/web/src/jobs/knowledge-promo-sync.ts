import { defineJob } from "@/lib/jobs/types";
import { syncPromosToMasterBrain } from "@/features/console/past-data";

/**
 * Promo Analyzer always feeds the Master Brain, whichever organization uses it.
 * Each run teaches as it finishes; this fills anything missing (promos analyzed
 * before learning-up existed, organizations later deleted, failed copies).
 * Only creates missing notes; idempotent; returns counts only.
 */
export const knowledgePromoSync = defineJob({
  name: "knowledge.promo-sync",
  description: "Make sure every analyzed promo, in every organization, is in the Master Brain.",
  schedule: "35 * * * *",
  async run() {
    return syncPromosToMasterBrain();
  },
});
