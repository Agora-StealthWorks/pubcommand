/**
 * A scheduled background job. Add one by creating `src/jobs/<name>.ts` that
 * exports a `defineJob(...)`, then list it in `src/jobs/index.ts`.
 *
 * - `schedule` is a 5-field cron expression evaluated in `timeZone`
 *   (default America/New_York), e.g. "0 * * * *" hourly, "30 9 * * 1" Mondays 9:30.
 * - `run` must be idempotent: a slot runs at most once across all servers, but a
 *   failed run is retried on the next slot, and "Run now" can run it any time.
 * - Jobs work across organizations: list orgs with `rawPrisma()` (ids only) and
 *   do every tenant read/write through `tenantDb(orgId)`.
 * - Return a small JSON summary (counts), shown in Admin → Jobs. Never return PII.
 */
export type JobContext = {
  scheduledFor: Date;
  trigger: "schedule" | "manual";
  log: (message: string) => void;
};

export type JobDefinition = {
  name: string;
  description: string;
  schedule: string;
  timeZone?: string;
  /** Mark a run failed if it takes longer than this. Default 15 minutes. */
  timeoutMs?: number;
  run: (ctx: JobContext) => Promise<Record<string, unknown> | void>;
};

export function defineJob(job: JobDefinition): JobDefinition {
  if (!/^[a-z0-9][a-z0-9.:-]*$/.test(job.name)) throw new Error(`Bad job name: ${job.name}`);
  return job;
}
