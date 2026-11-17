-- Scheduled background jobs: one row per run. Platform-wide (no organization).
CREATE TABLE "job_runs" (
    "id" UUID NOT NULL,
    "job" TEXT NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'schedule',
    "status" TEXT NOT NULL DEFAULT 'running',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "error" TEXT,
    "details" JSONB,
    "actor_id" UUID,
    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "job_runs_job_scheduled_for_key" ON "job_runs"("job", "scheduled_for");
CREATE INDEX "job_runs_job_started_at_idx" ON "job_runs"("job", "started_at");
