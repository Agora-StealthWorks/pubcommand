import { defineJob } from "@/lib/jobs/types";
import { drainVideoQueue } from "@/features/intel/video";

/**
 * Safety net for the video queue. A paste starts its capture right away; this
 * picks up anything left waiting (a restart, a capture queued while another ran).
 * Captures run one at a time.
 */
export const intelVideoCapture = defineJob({
  name: "intel.video-capture",
  description: "Capture queued competitor videos (download, transcribe, keyframes, AI extraction), one at a time.",
  schedule: "*/5 * * * *",
  timeoutMs: 55 * 60_000,
  async run() {
    return drainVideoQueue({ budgetMs: 50 * 60_000 });
  },
});
