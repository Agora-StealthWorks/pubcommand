import type { JobDefinition } from "@/lib/jobs/types";
import { consoleOxfordhubImport } from "./console-oxfordhub-import";
import { consolePastData } from "./console-past-data";
import { editorialBrainCatchup } from "./editorial-brain-catchup";
import { editorialSeriesExtend } from "./editorial-series-extend";
import { editorialTickerPrices } from "./editorial-ticker-prices";
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
import { knowledgeConflictCheck } from "./knowledge-conflict-check";
import { knowledgeIndustryLens } from "./knowledge-industry-lens";
import { knowledgeLearnUp } from "./knowledge-learn-up";
import { knowledgeVaultImport } from "./knowledge-vault-import";
import { knowledgePromoSync } from "./knowledge-promo-sync";
import { knowledgePushDown } from "./knowledge-push-down";
import { miniblogCalendarStatus } from "./miniblog-calendar-status";
import { performanceImportSync } from "./performance-import-sync";
import { performancePriceRefresh } from "./performance-price-refresh";
import { performanceWeeklyReport } from "./performance-weekly-report";
import { performanceWeeklySummary } from "./performance-weekly-summary";
import { platformOrgPurge } from "./platform-org-purge";
import { promoBulkReanalyze } from "./promo-bulk-reanalyze";
import { promoSheetsSync } from "./promo-sheets-sync";
import { supportPlatformSync } from "./support-platform-sync";
import { supportPubsetupSync } from "./support-pubsetup-sync";
import { supportWebsiteSheet } from "./support-website-sheet";

/**
 * Every scheduled job. Apps add theirs here (one import + one entry each).
 * Keep the list sorted by name.
 */
// Off for now (modules/editorial/features.ts): editorialAirtableSync (./editorial-airtable-sync)
// and editorialCubEmails (./editorial-cub-emails). Add them back here with their flags.
export const JOBS: JobDefinition[] = [
  consoleOxfordhubImport,
  consolePastData,
  editorialBrainCatchup,
  editorialSeriesExtend,
  editorialTickerPrices,
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
  knowledgeConflictCheck,
  knowledgeIndustryLens,
  knowledgeLearnUp,
  knowledgeVaultImport,
  knowledgePromoSync,
  knowledgePushDown,
  miniblogCalendarStatus,
  performanceImportSync,
  performancePriceRefresh,
  performanceWeeklyReport,
  performanceWeeklySummary,
  platformOrgPurge,
  promoBulkReanalyze,
  promoSheetsSync,
  supportPlatformSync,
  supportPubsetupSync,
  supportWebsiteSheet,
];
