import type { JobDefinition } from "@/lib/jobs/types";
import { jobRunsCleanup } from "./job-runs-cleanup";
import { knowledgeLearnUp } from "./knowledge-learn-up";
import { knowledgePushDown } from "./knowledge-push-down";

/**
 * Every scheduled job. Apps add theirs here (one import + one entry each).
 * Keep the list sorted by name.
 */
export const JOBS: JobDefinition[] = [knowledgeLearnUp, knowledgePushDown, jobRunsCleanup];
