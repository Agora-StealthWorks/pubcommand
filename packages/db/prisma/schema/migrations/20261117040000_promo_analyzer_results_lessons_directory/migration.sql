-- CreateTable
CREATE TABLE "promo_performance_imports" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'MAPPING',
    "error" TEXT,
    "headers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mapping" JSONB,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "code_count" INTEGER NOT NULL DEFAULT 0,
    "matched_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_performance_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_performance" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "import_id" UUID,
    "code_key" TEXT NOT NULL,
    "promo_code" TEXT NOT NULL,
    "label" TEXT,
    "promo_id" UUID,
    "sheet_type" TEXT,
    "start_date" DATE,
    "end_date" DATE,
    "sent" DOUBLE PRECISION,
    "views" DOUBLE PRECISION,
    "clicks" DOUBLE PRECISION,
    "orders" DOUBLE PRECISION,
    "revenue" DOUBLE PRECISION,
    "cost" DOUBLE PRECISION,
    "extra" JSONB,
    "cohort" TEXT,
    "cohort_size" INTEGER,
    "metric" TEXT,
    "metric_value" DOUBLE PRECISION,
    "percentile" DOUBLE PRECISION,
    "tier_scheme" TEXT,
    "tier" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_performance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_lessons" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'other',
    "origin" TEXT NOT NULL DEFAULT 'ai',
    "evidence_count" INTEGER NOT NULL DEFAULT 0,
    "promo_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "from_results" BOOLEAN NOT NULL DEFAULT false,
    "suggested_shared" BOOLEAN NOT NULL DEFAULT false,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "shared_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_lesson_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "input_count" INTEGER NOT NULL DEFAULT 0,
    "theme_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_lesson_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_entity_overrides" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "from_key" TEXT NOT NULL,
    "from_name" TEXT NOT NULL,
    "to_name" TEXT,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_entity_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "promo_performance_imports_organization_id_brand_id_created__idx" ON "promo_performance_imports"("organization_id", "brand_id", "created_at");

-- CreateIndex
CREATE INDEX "promo_performance_organization_id_brand_id_idx" ON "promo_performance"("organization_id", "brand_id");

-- CreateIndex
CREATE INDEX "promo_performance_promo_id_idx" ON "promo_performance"("promo_id");

-- CreateIndex
CREATE UNIQUE INDEX "promo_performance_brand_id_code_key_key" ON "promo_performance"("brand_id", "code_key");

-- CreateIndex
CREATE INDEX "promo_lessons_organization_id_brand_id_idx" ON "promo_lessons"("organization_id", "brand_id");

-- CreateIndex
CREATE INDEX "promo_lesson_runs_organization_id_brand_id_created_at_idx" ON "promo_lesson_runs"("organization_id", "brand_id", "created_at");

-- CreateIndex
CREATE INDEX "promo_entity_overrides_organization_id_brand_id_idx" ON "promo_entity_overrides"("organization_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "promo_entity_overrides_brand_id_kind_from_key_key" ON "promo_entity_overrides"("brand_id", "kind", "from_key");

-- Foreign keys (added by hand; no relation fields on shared models)
ALTER TABLE "promo_performance_imports" ADD CONSTRAINT "promo_performance_imports_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promo_performance_imports" ADD CONSTRAINT "promo_performance_imports_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promo_performance" ADD CONSTRAINT "promo_performance_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promo_performance" ADD CONSTRAINT "promo_performance_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promo_lessons" ADD CONSTRAINT "promo_lessons_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promo_lessons" ADD CONSTRAINT "promo_lessons_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promo_lesson_runs" ADD CONSTRAINT "promo_lesson_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promo_lesson_runs" ADD CONSTRAINT "promo_lesson_runs_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promo_entity_overrides" ADD CONSTRAINT "promo_entity_overrides_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promo_entity_overrides" ADD CONSTRAINT "promo_entity_overrides_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promo_performance" ADD CONSTRAINT "promo_performance_promo_id_fkey" FOREIGN KEY ("promo_id") REFERENCES "promos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "promo_performance" ADD CONSTRAINT "promo_performance_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "promo_performance_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['promo_performance_imports', 'promo_performance', 'promo_lessons', 'promo_lesson_runs', 'promo_entity_overrides']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (public.bypass_rls() OR organization_id = public.current_org_id()) WITH CHECK (public.bypass_rls() OR organization_id = public.current_org_id())', table_name);
  END LOOP;
END $$;
