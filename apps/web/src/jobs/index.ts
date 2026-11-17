import type { JobDefinition } from "@/lib/jobs/types";
import { formsMirrorRetry } from "./forms-mirror-retry";
import { formsNotifications } from "./forms-notifications";
import { formsOrphanCleanup } from "./forms-orphan-cleanup";
import { formsSchedule } from "./forms-schedule";
import { intelDigest } from "./intel-digest";
import { intelGmailSync } from "./intel-gmail-sync";
import { intelRadar } from "./intel-radar";
import { intelVideoCapture } from "./intel-video-capture";
import { jobRunsCleanup } from "./job-runs-cleanup";

/**
 * Every scheduled job. Apps add theirs here (one import + one entry each).
 * Keep the list sorted by name.
 */
export const JOBS: JobDefinition[] = [
  formsMirrorRetry,
  formsNotifications,
  formsOrphanCleanup,
  formsSchedule,
  intelDigest,
  intelGmailSync,
  intelRadar,
  intelVideoCapture,
  jobRunsCleanup,
];
