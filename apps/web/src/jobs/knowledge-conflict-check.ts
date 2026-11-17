import { defineJob } from "@/lib/jobs/types";
import { recheckEntities } from "@/features/brain-conflicts/check";

/**
 * Main-Brain conflict review: re-check every Publication Setup publication and
 * editor whose facts or matching main-Brain notes changed since its last check
 * (unchanged ones are skipped, so the AI only runs on what changed). Idempotent;
 * returns counts only.
 */
export const knowledgeConflictCheck = defineJob({
  name: "knowledge.conflict-check",
  description: "Compare changed Publication Setup facts with the main Brain and record conflicts.",
  schedule: "40 * * * *",
  async run() {
    return recheckEntities();
  },
});
