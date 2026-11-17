import type { JobDefinition } from "@/lib/jobs/types";
import { funnelsReminders } from "./funnels-reminders";
import { jobRunsCleanup } from "./job-runs-cleanup";
import { miniblogCalendarStatus } from "./miniblog-calendar-status";

/**
 * Every scheduled job. Apps add theirs here (one import + one entry each).
 * Keep the list sorted by name.
 */
export const JOBS: JobDefinition[] = [funnelsReminders, miniblogCalendarStatus, jobRunsCleanup];
