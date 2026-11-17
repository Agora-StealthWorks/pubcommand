import { defineJob } from "@/lib/jobs/types";
import { syncPushDown } from "@/features/main-brain/push";

/**
 * Keeps best-practice notes in brand Brains matching the main Brain's push-down
 * choices: new brands get notes pushed to "all brands", edits reach every copy,
 * withdrawn notes are removed. Idempotent; returns counts only.
 */
export const knowledgePushDown = defineJob({
  name: "knowledge.push-down",
  description: "Sync main-Brain best practices into the brands they are pushed to.",
  schedule: "40 * * * *",
  async run() {
    return syncPushDown();
  },
});
