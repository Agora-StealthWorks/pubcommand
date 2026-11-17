-- AlterTable
ALTER TABLE "calendar_cub_rounds" ADD COLUMN     "deadline_notified_at" TIMESTAMP(3),
ADD COLUMN     "initiator_email" TEXT,
ADD COLUMN     "initiator_name" TEXT,
ADD COLUMN     "promo_id" UUID,
ADD COLUMN     "public_base" TEXT,
ADD COLUMN     "reminder_sent_at" TIMESTAMP(3),
ADD COLUMN     "request_sent_at" TIMESTAMP(3),
ADD COLUMN     "reviewer_emails" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "calendar_events" ADD COLUMN     "airtable_id" TEXT,
ADD COLUMN     "airtable_synced_at" TIMESTAMP(3),
ADD COLUMN     "brain_taught_at" TIMESTAMP(3),
ADD COLUMN     "promo_id" UUID;

-- AlterTable
ALTER TABLE "calendar_issues" ADD COLUMN     "airtable_id" TEXT,
ADD COLUMN     "airtable_synced_at" TIMESTAMP(3),
ADD COLUMN     "brain_taught_at" TIMESTAMP(3),
ADD COLUMN     "promo_id" UUID,
ADD COLUMN     "tickers" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "calendar_series" ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "extended_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "calendar_email_templates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "recipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_email_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "round_id" UUID,
    "recipients" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_email_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_list_mappings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "label_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "pub_code" TEXT NOT NULL DEFAULT '',
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_list_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_field_options" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "color" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_field_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_promo_tracks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "promo_id" UUID NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'Idea',
    "launch_date" DATE,
    "launch_estimated" BOOLEAN NOT NULL DEFAULT false,
    "writers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_promo_tracks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_ticker_prices" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "ticker" TEXT NOT NULL,
    "issue_date" DATE NOT NULL,
    "issue_close" DOUBLE PRECISION,
    "peak" DOUBLE PRECISION,
    "peak_pct" DOUBLE PRECISION,
    "current" DOUBLE PRECISION,
    "current_pct" DOUBLE PRECISION,
    "source" TEXT,
    "error" TEXT,
    "fetched_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_ticker_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_airtable_connections" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "base_id" TEXT NOT NULL,
    "token_enc" TEXT NOT NULL,
    "events_table" TEXT,
    "issues_table" TEXT,
    "event_fields" JSONB,
    "issue_fields" JSONB,
    "read_only_fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_pull_at" TIMESTAMP(3),
    "last_status" TEXT,
    "last_error" TEXT,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_airtable_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_sync_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "direction" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "record_id" UUID,
    "airtable_id" TEXT,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calendar_email_templates_organization_id_brand_id_idx" ON "calendar_email_templates"("organization_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_email_templates_brand_id_kind_key" ON "calendar_email_templates"("brand_id", "kind");

-- CreateIndex
CREATE INDEX "calendar_email_logs_organization_id_brand_id_created_at_idx" ON "calendar_email_logs"("organization_id", "brand_id", "created_at");

-- CreateIndex
CREATE INDEX "calendar_email_logs_round_id_idx" ON "calendar_email_logs"("round_id");

-- CreateIndex
CREATE INDEX "calendar_list_mappings_organization_id_brand_id_idx" ON "calendar_list_mappings"("organization_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_list_mappings_brand_id_label_key_key" ON "calendar_list_mappings"("brand_id", "label_key");

-- CreateIndex
CREATE INDEX "calendar_field_options_organization_id_brand_id_field_idx" ON "calendar_field_options"("organization_id", "brand_id", "field");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_field_options_brand_id_field_value_key" ON "calendar_field_options"("brand_id", "field", "value");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_promo_tracks_promo_id_key" ON "calendar_promo_tracks"("promo_id");

-- CreateIndex
CREATE INDEX "calendar_promo_tracks_organization_id_brand_id_stage_idx" ON "calendar_promo_tracks"("organization_id", "brand_id", "stage");

-- CreateIndex
CREATE INDEX "calendar_ticker_prices_organization_id_brand_id_idx" ON "calendar_ticker_prices"("organization_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_ticker_prices_brand_id_ticker_issue_date_key" ON "calendar_ticker_prices"("brand_id", "ticker", "issue_date");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_airtable_connections_brand_id_key" ON "calendar_airtable_connections"("brand_id");

-- CreateIndex
CREATE INDEX "calendar_airtable_connections_organization_id_idx" ON "calendar_airtable_connections"("organization_id");

-- CreateIndex
CREATE INDEX "calendar_sync_logs_organization_id_brand_id_created_at_idx" ON "calendar_sync_logs"("organization_id", "brand_id", "created_at");

-- CreateIndex
CREATE INDEX "calendar_events_brand_id_airtable_id_idx" ON "calendar_events"("brand_id", "airtable_id");

-- CreateIndex
CREATE INDEX "calendar_events_promo_id_idx" ON "calendar_events"("promo_id");

-- CreateIndex
CREATE INDEX "calendar_issues_brand_id_airtable_id_idx" ON "calendar_issues"("brand_id", "airtable_id");

-- CreateIndex
CREATE INDEX "calendar_issues_promo_id_idx" ON "calendar_issues"("promo_id");

-- Foreign keys (added by hand: no relation fields on shared models)
ALTER TABLE "calendar_email_templates" ADD CONSTRAINT "calendar_email_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_email_templates" ADD CONSTRAINT "calendar_email_templates_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_email_logs" ADD CONSTRAINT "calendar_email_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_email_logs" ADD CONSTRAINT "calendar_email_logs_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_list_mappings" ADD CONSTRAINT "calendar_list_mappings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_list_mappings" ADD CONSTRAINT "calendar_list_mappings_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_field_options" ADD CONSTRAINT "calendar_field_options_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_field_options" ADD CONSTRAINT "calendar_field_options_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_promo_tracks" ADD CONSTRAINT "calendar_promo_tracks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_promo_tracks" ADD CONSTRAINT "calendar_promo_tracks_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_ticker_prices" ADD CONSTRAINT "calendar_ticker_prices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_ticker_prices" ADD CONSTRAINT "calendar_ticker_prices_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_airtable_connections" ADD CONSTRAINT "calendar_airtable_connections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_airtable_connections" ADD CONSTRAINT "calendar_airtable_connections_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_sync_logs" ADD CONSTRAINT "calendar_sync_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_sync_logs" ADD CONSTRAINT "calendar_sync_logs_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_promo_id_fkey" FOREIGN KEY ("promo_id") REFERENCES "promos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "calendar_issues" ADD CONSTRAINT "calendar_issues_promo_id_fkey" FOREIGN KEY ("promo_id") REFERENCES "promos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "calendar_cub_rounds" ADD CONSTRAINT "calendar_cub_rounds_promo_id_fkey" FOREIGN KEY ("promo_id") REFERENCES "promos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "calendar_promo_tracks" ADD CONSTRAINT "calendar_promo_tracks_promo_id_fkey" FOREIGN KEY ("promo_id") REFERENCES "promos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['calendar_email_templates', 'calendar_email_logs', 'calendar_list_mappings', 'calendar_field_options', 'calendar_promo_tracks', 'calendar_ticker_prices', 'calendar_airtable_connections', 'calendar_sync_logs']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (public.bypass_rls() OR organization_id = public.current_org_id()) WITH CHECK (public.bypass_rls() OR organization_id = public.current_org_id())', table_name);
  END LOOP;
END $$;
