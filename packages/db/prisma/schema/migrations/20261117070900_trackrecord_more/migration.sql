-- Track Record: legs and fills, AI read of call backups, embeddable widgets, weekly report, Sheets/Airtable import sources. Additive only.

-- AlterTable
ALTER TABLE "track_call_files" ADD COLUMN     "transcript" TEXT,
ADD COLUMN     "transcript_error" TEXT,
ADD COLUMN     "transcript_status" TEXT NOT NULL DEFAULT 'none';

-- AlterTable
ALTER TABLE "track_calls" ADD COLUMN     "ai_error" TEXT,
ADD COLUMN     "ai_proposal" JSONB,
ADD COLUMN     "ai_run_at" TIMESTAMP(3),
ADD COLUMN     "ai_status" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "price_check" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "target_price" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "track_portfolios" ADD COLUMN     "widget_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "widget_include_open" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "widget_token" TEXT;

-- AlterTable
ALTER TABLE "track_positions" ADD COLUMN     "fill_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "realized_pnl" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "track_legs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "position_id" UUID NOT NULL,
    "leg_index" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'STOCK',
    "symbol" TEXT NOT NULL,
    "price_symbol" TEXT,
    "option_right" TEXT,
    "strike" DOUBLE PRECISION,
    "expiry" DATE,
    "side" TEXT NOT NULL DEFAULT 'BUY',
    "ratio" INTEGER NOT NULL DEFAULT 1,
    "multiplier" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "track_legs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "track_fills" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "position_id" UUID NOT NULL,
    "leg_id" UUID NOT NULL,
    "intent" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "multiplier" INTEGER NOT NULL DEFAULT 1,
    "executed_at" DATE NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "track_fills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "track_report_settings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "auto_send" BOOLEAN NOT NULL DEFAULT true,
    "recipient_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "track_report_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "track_weekly_reports" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "week" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "sent_at" TIMESTAMP(3),
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "track_weekly_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "track_import_sources" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sheet_id" TEXT,
    "sheet_gid" TEXT,
    "sheet_range" TEXT,
    "airtable_base" TEXT,
    "airtable_table" TEXT,
    "airtable_view" TEXT,
    "token_enc" TEXT,
    "default_portfolio" TEXT NOT NULL DEFAULT '',
    "auto_sync" BOOLEAN NOT NULL DEFAULT true,
    "last_sync_at" TIMESTAMP(3),
    "last_status" TEXT,
    "last_message" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "track_import_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "track_legs_position_id_leg_index_key" ON "track_legs"("position_id", "leg_index");

-- CreateIndex
CREATE INDEX "track_fills_position_id_deleted_at_idx" ON "track_fills"("position_id", "deleted_at");

-- CreateIndex
CREATE INDEX "track_fills_leg_id_idx" ON "track_fills"("leg_id");

-- CreateIndex
CREATE UNIQUE INDEX "track_report_settings_organization_id_brand_id_key" ON "track_report_settings"("organization_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "track_weekly_reports_organization_id_brand_id_week_key" ON "track_weekly_reports"("organization_id", "brand_id", "week");

-- CreateIndex
CREATE INDEX "track_import_sources_organization_id_brand_id_deleted_at_idx" ON "track_import_sources"("organization_id", "brand_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "track_portfolios_widget_token_key" ON "track_portfolios"("widget_token");

-- AddForeignKey
ALTER TABLE "track_legs" ADD CONSTRAINT "track_legs_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "track_positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "track_fills" ADD CONSTRAINT "track_fills_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "track_positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "track_fills" ADD CONSTRAINT "track_fills_leg_id_fkey" FOREIGN KEY ("leg_id") REFERENCES "track_legs"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Organization and brand foreign keys (added by hand: no relation fields on shared models).
ALTER TABLE "track_legs" ADD CONSTRAINT "track_legs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "track_fills" ADD CONSTRAINT "track_fills_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "track_report_settings" ADD CONSTRAINT "track_report_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "track_report_settings" ADD CONSTRAINT "track_report_settings_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "track_weekly_reports" ADD CONSTRAINT "track_weekly_reports_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "track_weekly_reports" ADD CONSTRAINT "track_weekly_reports_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "track_import_sources" ADD CONSTRAINT "track_import_sources_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "track_import_sources" ADD CONSTRAINT "track_import_sources_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security: tenant isolation.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['track_legs', 'track_fills', 'track_report_settings', 'track_weekly_reports', 'track_import_sources']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (public.bypass_rls() OR organization_id = public.current_org_id()) WITH CHECK (public.bypass_rls() OR organization_id = public.current_org_id())', table_name);
  END LOOP;
END $$;
