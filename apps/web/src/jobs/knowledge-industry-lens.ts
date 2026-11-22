import { defineJob } from "@/lib/jobs/types";
import { reframeMainBrainNotes } from "@/features/main-brain/lens";

/** Keep the Master Brain in the industry lens: no organization's "competitors". Only changed notes are written. */
export const knowledgeIndustryLens = defineJob({
  name: "knowledge.industry-lens",
  description: "Reframe Master Brain notes as industry knowledge (competitors are an organization's view).",
  schedule: "50 * * * *",
  async run() {
    return reframeMainBrainNotes();
  },
});
