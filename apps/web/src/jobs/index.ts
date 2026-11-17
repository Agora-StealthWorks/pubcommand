import type { JobDefinition } from "@/lib/jobs/types";
import { jobRunsCleanup } from "./job-runs-cleanup";
import { performanceImportSync } from "./performance-import-sync";
import { performancePriceRefresh } from "./performance-price-refresh";
import { performanceWeeklyReport } from "./performance-weekly-report";
import { performanceWeeklySummary } from "./performance-weekly-summary";

/**
 * Every scheduled job. Apps add theirs here (one import + one entry each).
 * Keep the list sorted by name.
 */
export const JOBS: JobDefinition[] = [
  performanceImportSync,
  performancePriceRefresh,
  performanceWeeklyReport,
  performanceWeeklySummary,
  jobRunsCleanup,
];
