import type { JobDefinition } from "@/lib/jobs/types";
import { formsMirrorRetry } from "./forms-mirror-retry";
import { formsNotifications } from "./forms-notifications";
import { formsOrphanCleanup } from "./forms-orphan-cleanup";
import { formsSchedule } from "./forms-schedule";
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
  jobRunsCleanup,
];
