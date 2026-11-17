import type { JobDefinition } from "@/lib/jobs/types";
import { jobRunsCleanup } from "./job-runs-cleanup";
import { promoBulkReanalyze } from "./promo-bulk-reanalyze";
import { promoSheetsSync } from "./promo-sheets-sync";

/**
 * Every scheduled job. Apps add theirs here (one import + one entry each).
 * Keep the list sorted by name.
 */
export const JOBS: JobDefinition[] = [jobRunsCleanup, promoBulkReanalyze, promoSheetsSync];
