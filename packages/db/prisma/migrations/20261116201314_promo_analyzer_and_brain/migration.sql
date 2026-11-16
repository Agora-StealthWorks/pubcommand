-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('NONE', 'QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "KnowledgeVisibility" AS ENUM ('PRIVATE', 'SHARED');

-- CreateTable
CREATE TABLE "promos" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "filename" TEXT,
    "input_type" TEXT NOT NULL DEFAULT 'text',
    "source_text" TEXT NOT NULL DEFAULT '',
    "publisher" TEXT,
    "gurus" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "product" TEXT,
    "promo_type" TEXT,
    "promo_status" TEXT,
    "promo_code" TEXT,
    "run_start_date" DATE,
    "price_point" DECIMAL(10,2),
    "analysis_status" "AnalysisStatus" NOT NULL DEFAULT 'NONE',
    "analysis_error" TEXT,
    "effectiveness_score" DOUBLE PRECISION,
    "fk_reading_ease" DOUBLE PRECISION,
    "fk_grade_level" DOUBLE PRECISION,
    "my_score" DOUBLE PRECISION,
    "performance_score" DOUBLE PRECISION,
    "training_notes" TEXT,
    "is_best_performer" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "promos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_analyses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "promo_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "score" DOUBLE PRECISION,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_files" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "promo_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'supplemental',
    "category" TEXT,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_pages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" "KnowledgeVisibility" NOT NULL DEFAULT 'PRIVATE',
    "folder" TEXT,
    "source" TEXT NOT NULL DEFAULT 'member',
    "source_ref" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "module_id" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "promos_organization_id_brand_id_created_at_idx" ON "promos"("organization_id", "brand_id", "created_at");

-- CreateIndex
CREATE INDEX "promo_analyses_organization_id_idx" ON "promo_analyses"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "promo_analyses_promo_id_version_key" ON "promo_analyses"("promo_id", "version");

-- CreateIndex
CREATE INDEX "promo_files_organization_id_promo_id_idx" ON "promo_files"("organization_id", "promo_id");

-- CreateIndex
CREATE INDEX "knowledge_pages_organization_id_brand_id_idx" ON "knowledge_pages"("organization_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_pages_organization_id_slug_key" ON "knowledge_pages"("organization_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_pages_organization_id_source_ref_key" ON "knowledge_pages"("organization_id", "source_ref");

-- CreateIndex
CREATE INDEX "ai_usage_logs_organization_id_created_at_idx" ON "ai_usage_logs"("organization_id", "created_at");

-- AddForeignKey
ALTER TABLE "promos" ADD CONSTRAINT "promos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promos" ADD CONSTRAINT "promos_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_analyses" ADD CONSTRAINT "promo_analyses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_analyses" ADD CONSTRAINT "promo_analyses_promo_id_fkey" FOREIGN KEY ("promo_id") REFERENCES "promos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_files" ADD CONSTRAINT "promo_files_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_files" ADD CONSTRAINT "promo_files_promo_id_fkey" FOREIGN KEY ("promo_id") REFERENCES "promos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_pages" ADD CONSTRAINT "knowledge_pages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_pages" ADD CONSTRAINT "knowledge_pages_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation for the new tables (same policy as the foundation tables).
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['promos', 'promo_analyses', 'promo_files', 'knowledge_pages', 'ai_usage_logs']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (public.bypass_rls() OR organization_id = public.current_org_id()) WITH CHECK (public.bypass_rls() OR organization_id = public.current_org_id())',
      table_name
    );
  END LOOP;
END $$;
