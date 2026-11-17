import { defineJob } from "@/lib/jobs/types";
import { learnUpBackfill } from "@/features/main-brain/learn";

/**
 * Safety net for learning up. teachBrain() already copies each app-taught note
 * into the platform main Brain as it is written; this catches notes taught before
 * that existed, or whose copy failed. Idempotent; returns counts only.
 */
export const knowledgeLearnUp = defineJob({
  name: "knowledge.learn-up",
  description: "Copy app-taught brand notes that are missing or stale in the main Brain.",
  schedule: "20 * * * *",
  async run() {
    return learnUpBackfill();
  },
});
