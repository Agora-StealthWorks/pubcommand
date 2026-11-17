-- CreateTable
CREATE TABLE "chart_templates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "slug" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'PROMO',
    "style" JSONB NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 100,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "chart_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chart_projects" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "chart_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "project_id" UUID,
    "batch_id" UUID,
    "template_id" UUID,
    "name" TEXT NOT NULL DEFAULT '',
    "symbol" TEXT NOT NULL,
    "spec" JSONB NOT NULL,
    "bars" JSONB NOT NULL,
    "stats" JSONB,
    "tokens" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "series_name" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT '$',
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "headline" TEXT NOT NULL DEFAULT '',
    "headline_overridden" BOOLEAN NOT NULL DEFAULT false,
    "created_via" TEXT NOT NULL DEFAULT 'ui',
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "charts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chart_batches" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "rows" JSONB NOT NULL,
    "design" JSONB NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 0,
    "done" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chart_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chart_assets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chart_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_cache" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_cache_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "chart_templates_organization_id_deleted_at_idx" ON "chart_templates"("organization_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "chart_templates_organization_id_slug_key" ON "chart_templates"("organization_id", "slug");

-- CreateIndex
CREATE INDEX "chart_projects_organization_id_brand_id_deleted_at_idx" ON "chart_projects"("organization_id", "brand_id", "deleted_at");

-- CreateIndex
CREATE INDEX "charts_organization_id_brand_id_deleted_at_updated_at_idx" ON "charts"("organization_id", "brand_id", "deleted_at", "updated_at");

-- CreateIndex
CREATE INDEX "charts_project_id_deleted_at_idx" ON "charts"("project_id", "deleted_at");

-- CreateIndex
CREATE INDEX "charts_batch_id_idx" ON "charts"("batch_id");

-- CreateIndex
CREATE INDEX "charts_symbol_idx" ON "charts"("symbol");

-- CreateIndex
CREATE INDEX "chart_batches_organization_id_brand_id_created_at_idx" ON "chart_batches"("organization_id", "brand_id", "created_at");

-- CreateIndex
CREATE INDEX "chart_assets_organization_id_brand_id_idx" ON "chart_assets"("organization_id", "brand_id");

-- CreateIndex
CREATE INDEX "market_cache_expires_at_idx" ON "market_cache"("expires_at");

-- AddForeignKey
ALTER TABLE "charts" ADD CONSTRAINT "charts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "chart_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charts" ADD CONSTRAINT "charts_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "chart_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Tenant foreign keys (no Prisma relations on shared models).
ALTER TABLE "chart_templates" ADD CONSTRAINT "chart_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chart_projects" ADD CONSTRAINT "chart_projects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chart_projects" ADD CONSTRAINT "chart_projects_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "charts" ADD CONSTRAINT "charts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "charts" ADD CONSTRAINT "charts_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chart_batches" ADD CONSTRAINT "chart_batches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chart_batches" ADD CONSTRAINT "chart_batches_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chart_assets" ADD CONSTRAINT "chart_assets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chart_assets" ADD CONSTRAINT "chart_assets_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security for every tenant table (market_cache holds public prices only and has no tenant).
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['chart_templates', 'chart_projects', 'charts', 'chart_batches', 'chart_assets']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (public.bypass_rls() OR organization_id = public.current_org_id()) WITH CHECK (public.bypass_rls() OR organization_id = public.current_org_id())', table_name);
  END LOOP;
END $$;
