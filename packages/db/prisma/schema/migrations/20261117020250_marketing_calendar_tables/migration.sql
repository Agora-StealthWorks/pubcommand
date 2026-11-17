-- CreateTable
CREATE TABLE "calendar_publications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#7f77dd',
    "description" TEXT,
    "logo_filename" TEXT,
    "logo_mime" TEXT,
    "logo_data" BYTEA,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_channels" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#27455c',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_series" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "starts_on" DATE NOT NULL,
    "until" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "profile" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "event_type" TEXT,
    "format" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'Idea',
    "marketing_start" DATE,
    "event_date" DATE,
    "event_end" DATE,
    "marketing_end" DATE,
    "start_time" TEXT,
    "end_time" TEXT,
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hosts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "offer" TEXT,
    "promo_code" TEXT,
    "cta_link" TEXT,
    "registration_link" TEXT,
    "replay_link" TEXT,
    "notes" TEXT,
    "peak_attendance" INTEGER,
    "avg_attendance" INTEGER,
    "registrations" INTEGER,
    "new_subscribers" INTEGER,
    "leads" INTEGER,
    "orders" INTEGER,
    "revenue" DOUBLE PRECISION,
    "messages" INTEGER,
    "series_id" UUID,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_issues" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "publication_code" TEXT NOT NULL,
    "mail_date" DATE,
    "title" TEXT NOT NULL,
    "subject_lines" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'Planned',
    "issue_type" TEXT,
    "writer" TEXT,
    "body" TEXT,
    "notes" TEXT,
    "website_link" TEXT,
    "cta_link" TEXT,
    "offer" TEXT,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "calendar_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_send_stats" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "issue_id" UUID NOT NULL,
    "import_id" UUID,
    "list_label" TEXT,
    "pub_code" TEXT,
    "mail_date" DATE,
    "subject" TEXT,
    "delivered" INTEGER,
    "open_rate" DOUBLE PRECISION,
    "click_rate" DOUBLE PRECISION,
    "click_to_open" DOUBLE PRECISION,
    "revenue" DOUBLE PRECISION,
    "total_opened" INTEGER,
    "total_clicked" INTEGER,
    "unsubscribes" INTEGER,
    "complaints" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_send_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_stat_imports" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "rows_parsed" INTEGER NOT NULL DEFAULT 0,
    "matched" INTEGER NOT NULL DEFAULT 0,
    "unmatched" INTEGER NOT NULL DEFAULT 0,
    "unmatched_rows" JSONB,
    "mapping" JSONB,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_stat_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_insights" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "window_days" INTEGER NOT NULL DEFAULT 30,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "model" TEXT,
    "facts" JSONB,
    "content" JSONB,
    "issue_count" INTEGER NOT NULL DEFAULT 0,
    "data_from" DATE,
    "data_to" DATE,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_cub_rounds" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "promo_name" TEXT NOT NULL,
    "instructions" TEXT,
    "draft_filename" TEXT NOT NULL,
    "draft_mime" TEXT NOT NULL,
    "draft_size" INTEGER NOT NULL,
    "draft_data" BYTEA NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "review_token" TEXT NOT NULL,
    "owner_token" TEXT NOT NULL,
    "closed_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_cub_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_cub_reviews" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "round_id" UUID NOT NULL,
    "reviewer_name" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "score_headline" INTEGER NOT NULL,
    "score_story" INTEGER NOT NULL,
    "score_offer" INTEGER NOT NULL,
    "score_overall" INTEGER NOT NULL,
    "comments" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_cub_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calendar_publications_organization_id_brand_id_idx" ON "calendar_publications"("organization_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_publications_brand_id_code_key" ON "calendar_publications"("brand_id", "code");

-- CreateIndex
CREATE INDEX "calendar_channels_organization_id_brand_id_idx" ON "calendar_channels"("organization_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_channels_brand_id_name_key" ON "calendar_channels"("brand_id", "name");

-- CreateIndex
CREATE INDEX "calendar_series_organization_id_brand_id_idx" ON "calendar_series"("organization_id", "brand_id");

-- CreateIndex
CREATE INDEX "calendar_events_organization_id_brand_id_event_date_idx" ON "calendar_events"("organization_id", "brand_id", "event_date");

-- CreateIndex
CREATE INDEX "calendar_events_series_id_idx" ON "calendar_events"("series_id");

-- CreateIndex
CREATE INDEX "calendar_issues_organization_id_brand_id_mail_date_idx" ON "calendar_issues"("organization_id", "brand_id", "mail_date");

-- CreateIndex
CREATE INDEX "calendar_issues_brand_id_publication_code_idx" ON "calendar_issues"("brand_id", "publication_code");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_send_stats_issue_id_key" ON "calendar_send_stats"("issue_id");

-- CreateIndex
CREATE INDEX "calendar_send_stats_organization_id_pub_code_mail_date_idx" ON "calendar_send_stats"("organization_id", "pub_code", "mail_date");

-- CreateIndex
CREATE INDEX "calendar_stat_imports_organization_id_brand_id_created_at_idx" ON "calendar_stat_imports"("organization_id", "brand_id", "created_at");

-- CreateIndex
CREATE INDEX "calendar_insights_organization_id_brand_id_created_at_idx" ON "calendar_insights"("organization_id", "brand_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_cub_rounds_review_token_key" ON "calendar_cub_rounds"("review_token");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_cub_rounds_owner_token_key" ON "calendar_cub_rounds"("owner_token");

-- CreateIndex
CREATE INDEX "calendar_cub_rounds_organization_id_brand_id_created_at_idx" ON "calendar_cub_rounds"("organization_id", "brand_id", "created_at");

-- CreateIndex
CREATE INDEX "calendar_cub_reviews_organization_id_round_id_idx" ON "calendar_cub_reviews"("organization_id", "round_id");

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "calendar_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_send_stats" ADD CONSTRAINT "calendar_send_stats_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "calendar_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_cub_reviews" ADD CONSTRAINT "calendar_cub_reviews_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "calendar_cub_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Organization and brand foreign keys (added by hand; no relation fields on shared models).
ALTER TABLE "calendar_publications" ADD CONSTRAINT "calendar_publications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_channels" ADD CONSTRAINT "calendar_channels_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_series" ADD CONSTRAINT "calendar_series_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_issues" ADD CONSTRAINT "calendar_issues_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_stat_imports" ADD CONSTRAINT "calendar_stat_imports_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_insights" ADD CONSTRAINT "calendar_insights_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_cub_rounds" ADD CONSTRAINT "calendar_cub_rounds_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_send_stats" ADD CONSTRAINT "calendar_send_stats_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_cub_reviews" ADD CONSTRAINT "calendar_cub_reviews_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_publications" ADD CONSTRAINT "calendar_publications_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_channels" ADD CONSTRAINT "calendar_channels_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_series" ADD CONSTRAINT "calendar_series_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_issues" ADD CONSTRAINT "calendar_issues_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_stat_imports" ADD CONSTRAINT "calendar_stat_imports_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_insights" ADD CONSTRAINT "calendar_insights_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_cub_rounds" ADD CONSTRAINT "calendar_cub_rounds_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['calendar_publications', 'calendar_channels', 'calendar_series', 'calendar_events', 'calendar_issues', 'calendar_stat_imports', 'calendar_insights', 'calendar_cub_rounds', 'calendar_send_stats', 'calendar_cub_reviews']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (public.bypass_rls() OR organization_id = public.current_org_id()) WITH CHECK (public.bypass_rls() OR organization_id = public.current_org_id())', table_name);
  END LOOP;
END $$;
