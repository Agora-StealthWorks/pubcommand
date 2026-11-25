-- App usage: sign-ins, time in each app, what people built (with content snapshots),
-- web server memory samples, and the Operations Brain (strategic notes).
-- Sessions now end after the user's idle timeout (default 12 hours; per user in the console).

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "last_active_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "idle_timeout_minutes" INTEGER;

-- CreateTable
CREATE TABLE "usage_logins" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "site" TEXT NOT NULL,
    "organization_id" UUID,
    "user_agent" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_logins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_daily" (
    "id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "user_id" UUID NOT NULL,
    "site" TEXT NOT NULL,
    "organization_id" UUID,
    "app" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "active_seconds" INTEGER NOT NULL DEFAULT 0,
    "bytes" BIGINT NOT NULL DEFAULT 0,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_activities" (
    "id" UUID NOT NULL,
    "audit_log_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "actor_id" UUID,
    "actor_kind" TEXT NOT NULL,
    "app" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "verb" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "title" TEXT,
    "summary" TEXT NOT NULL,
    "content" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_server_samples" (
    "id" UUID NOT NULL,
    "service" TEXT NOT NULL,
    "instance" TEXT NOT NULL,
    "rss_bytes" BIGINT NOT NULL,
    "heap_used_bytes" BIGINT NOT NULL,
    "heap_total_bytes" BIGINT NOT NULL,
    "external_bytes" BIGINT NOT NULL,
    "cpu_percent" DOUBLE PRECISION,
    "uptime_seconds" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_server_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_brain_notes" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "period_start" TIMESTAMP(3),
    "period_end" TIMESTAMP(3),
    "stats" JSONB,
    "model" TEXT,
    "source" TEXT NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "search_vector" tsvector GENERATED ALWAYS AS (
      setweight(to_tsvector('english'::regconfig, COALESCE(title, ''::text)), 'A'::"char") || setweight(to_tsvector('english'::regconfig, "left"(COALESCE(body, ''::text), 500000)), 'B'::"char")
    ) STORED,

    CONSTRAINT "ops_brain_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "usage_logins_created_at_idx" ON "usage_logins"("created_at");

-- CreateIndex
CREATE INDEX "usage_logins_user_id_created_at_idx" ON "usage_logins"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "usage_daily_day_idx" ON "usage_daily"("day");

-- CreateIndex
CREATE INDEX "usage_daily_user_id_day_idx" ON "usage_daily"("user_id", "day");

-- CreateIndex
CREATE INDEX "usage_daily_organization_id_day_idx" ON "usage_daily"("organization_id", "day");

-- CreateIndex
CREATE UNIQUE INDEX "usage_daily_day_user_id_site_area_key" ON "usage_daily"("day", "user_id", "site", "area");

-- CreateIndex
CREATE UNIQUE INDEX "usage_activities_audit_log_id_key" ON "usage_activities"("audit_log_id");

-- CreateIndex
CREATE INDEX "usage_activities_created_at_idx" ON "usage_activities"("created_at");

-- CreateIndex
CREATE INDEX "usage_activities_organization_id_created_at_idx" ON "usage_activities"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "usage_activities_actor_id_created_at_idx" ON "usage_activities"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "usage_activities_app_created_at_idx" ON "usage_activities"("app", "created_at");

-- CreateIndex
CREATE INDEX "usage_server_samples_created_at_idx" ON "usage_server_samples"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ops_brain_notes_key_key" ON "ops_brain_notes"("key");

-- CreateIndex
CREATE INDEX "ops_brain_notes_kind_period_start_idx" ON "ops_brain_notes"("kind", "period_start");

-- CreateIndex
CREATE INDEX "ops_brain_notes_search_vector_idx" ON "ops_brain_notes" USING GIN ("search_vector");

-- Platform tables: only platform code that sets app.bypass_rls may read or write them.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['usage_logins', 'usage_daily', 'usage_activities', 'usage_server_samples', 'ops_brain_notes']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS platform_only ON %I', table_name);
    EXECUTE format('CREATE POLICY platform_only ON %I USING (public.bypass_rls()) WITH CHECK (public.bypass_rls())', table_name);
  END LOOP;
END $$;
