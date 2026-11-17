import type { JobDefinition } from "@/lib/jobs/types";
import { formsMirrorRetry } from "./forms-mirror-retry";
import { formsNotifications } from "./forms-notifications";
import { formsOrphanCleanup } from "./forms-orphan-cleanup";
import { formsSchedule } from "./forms-schedule";
import { funnelsReminders } from "./funnels-reminders";
import { intelDigest } from "./intel-digest";
import { intelGmailSync } from "./intel-gmail-sync";
import { intelRadar } from "./intel-radar";
import { intelVideoCapture } from "./intel-video-capture";
import { jobRunsCleanup } from "./job-runs-cleanup";
import { miniblogCalendarStatus } from "./miniblog-calendar-status";
import { performanceImportSync } from "./performance-import-sync";
import { performancePriceRefresh } from "./performance-price-refresh";
import { performanceWeeklyReport } from "./performance-weekly-report";
import { performanceWeeklySummary } from "./performance-weekly-summary";
import { promoBulkReanalyze } from "./promo-bulk-reanalyze";
import { promoSheetsSync } from "./promo-sheets-sync";

/**
 * Every scheduled job. Apps add theirs here (one import + one entry each).
 * Keep the list sorted by name.
 */
export const JOBS: JobDefinition[] = [
  formsMirrorRetry,
  formsNotifications,
  formsOrphanCleanup,
  formsSchedule,
  funnelsReminders,
  intelDigest,
  intelGmailSync,
  intelRadar,
  intelVideoCapture,
  jobRunsCleanup,
  miniblogCalendarStatus,
  performanceImportSync,
  performancePriceRefresh,
  performanceWeeklyReport,
  performanceWeeklySummary,
  promoBulkReanalyze,
  promoSheetsSync,
];
