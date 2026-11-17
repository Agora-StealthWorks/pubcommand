-- Copy apps: sheet sync, durable bulk queue, tier overrides, undo import, training library, package research, research condense.

-- AlterTable
ALTER TABLE "promo_package_components" ADD COLUMN     "examples_used" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "promo_packages" ADD COLUMN     "research" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "research_error" TEXT,
ADD COLUMN     "research_status" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "researched_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "promo_performance" ADD COLUMN     "computed_tier" TEXT,
ADD COLUMN     "linked_manually" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tier_override" TEXT,
ADD COLUMN     "tier_override_at" TIMESTAMP(3),
ADD COLUMN     "tier_override_by_id" UUID,
ADD COLUMN     "tier_override_reason" TEXT;

-- AlterTable
ALTER TABLE "promo_performance_imports" ADD COLUMN     "content_hash" TEXT,
ADD COLUMN     "created_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "previous" JSONB,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'upload',
ADD COLUMN     "undone_at" TIMESTAMP(3),
ADD COLUMN     "undone_by_id" UUID;

-- AlterTable
ALTER TABLE "research_cards" ADD COLUMN     "condensed_from" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "research_projects" ADD COLUMN     "condense_error" TEXT,
ADD COLUMN     "condense_status" TEXT NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "research_sources" ADD COLUMN     "read_via" TEXT;

-- CreateTable
CREATE TABLE "promo_training_examples" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "publication" TEXT,
    "niche" TEXT NOT NULL DEFAULT 'general',
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "source_ref" TEXT,
    "promo_id" UUID,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_training_examples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_sheet_syncs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "spreadsheet_id" TEXT NOT NULL,
    "range" TEXT NOT NULL DEFAULT 'Sheet1',
    "credentials" TEXT,
    "client_email" TEXT,
    "headers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mapping" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "every_hours" INTEGER NOT NULL DEFAULT 6,
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "last_error" TEXT,
    "last_sync_at" TIMESTAMP(3),
    "last_hash" TEXT,
    "last_import_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_sheet_syncs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_bulk_jobs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "promo_id" UUID NOT NULL,
    "actor_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "locked_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_bulk_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "promo_training_examples_organization_id_brand_id_kind_idx" ON "promo_training_examples"("organization_id", "brand_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "promo_training_examples_brand_id_source_ref_key" ON "promo_training_examples"("brand_id", "source_ref");

-- CreateIndex
CREATE INDEX "promo_sheet_syncs_organization_id_idx" ON "promo_sheet_syncs"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "promo_sheet_syncs_brand_id_key" ON "promo_sheet_syncs"("brand_id");

-- CreateIndex
CREATE INDEX "promo_bulk_jobs_status_created_at_idx" ON "promo_bulk_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "promo_bulk_jobs_organization_id_brand_id_status_idx" ON "promo_bulk_jobs"("organization_id", "brand_id", "status");

-- CreateIndex
CREATE INDEX "promo_bulk_jobs_promo_id_idx" ON "promo_bulk_jobs"("promo_id");

-- The computed tier starts as the tier already stored.
UPDATE "promo_performance" SET "computed_tier" = "tier" WHERE "computed_tier" IS NULL;

-- Foreign keys (added by hand: no relation fields on shared models).
ALTER TABLE "promo_training_examples" ADD CONSTRAINT "promo_training_examples_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promo_training_examples" ADD CONSTRAINT "promo_training_examples_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promo_training_examples" ADD CONSTRAINT "promo_training_examples_promo_id_fkey" FOREIGN KEY ("promo_id") REFERENCES "promos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "promo_sheet_syncs" ADD CONSTRAINT "promo_sheet_syncs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promo_sheet_syncs" ADD CONSTRAINT "promo_sheet_syncs_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promo_bulk_jobs" ADD CONSTRAINT "promo_bulk_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promo_bulk_jobs" ADD CONSTRAINT "promo_bulk_jobs_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promo_bulk_jobs" ADD CONSTRAINT "promo_bulk_jobs_promo_id_fkey" FOREIGN KEY ("promo_id") REFERENCES "promos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['promo_training_examples', 'promo_sheet_syncs', 'promo_bulk_jobs']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (public.bypass_rls() OR organization_id = public.current_org_id()) WITH CHECK (public.bypass_rls() OR organization_id = public.current_org_id())', table_name);
  END LOOP;
END $$;
