-- CreateEnum
CREATE TYPE "PackageStatus" AS ENUM ('DRAFT', 'APPROVED');

-- CreateEnum
CREATE TYPE "PackageComponentStatus" AS ENUM ('DRAFT', 'NEEDS_EDITS', 'APPROVED');

-- CreateTable
CREATE TABLE "promo_packages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "promo_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "status" "PackageStatus" NOT NULL DEFAULT 'DRAFT',
    "direction" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" UUID,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "promo_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_package_components" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "content" TEXT NOT NULL DEFAULT '',
    "status" "PackageComponentStatus" NOT NULL DEFAULT 'DRAFT',
    "gen_status" "AnalysisStatus" NOT NULL DEFAULT 'NONE',
    "gen_error" TEXT,
    "flags" JSONB NOT NULL DEFAULT '[]',
    "current_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_package_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_package_component_versions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "component_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "feedback" TEXT,
    "model" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_package_component_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "promo_packages_organization_id_brand_id_promo_id_idx" ON "promo_packages"("organization_id", "brand_id", "promo_id");

-- CreateIndex
CREATE INDEX "promo_package_components_organization_id_idx" ON "promo_package_components"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "promo_package_components_package_id_kind_key" ON "promo_package_components"("package_id", "kind");

-- CreateIndex
CREATE INDEX "promo_package_component_versions_organization_id_idx" ON "promo_package_component_versions"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "promo_package_component_versions_component_id_version_key" ON "promo_package_component_versions"("component_id", "version");

-- AddForeignKey
ALTER TABLE "promo_package_components" ADD CONSTRAINT "promo_package_components_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "promo_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_package_component_versions" ADD CONSTRAINT "promo_package_component_versions_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "promo_package_components"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Foreign keys to shared tables (no relation fields on Organization / Brand / Promo).
ALTER TABLE "promo_packages" ADD CONSTRAINT "promo_packages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promo_packages" ADD CONSTRAINT "promo_packages_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promo_packages" ADD CONSTRAINT "promo_packages_promo_id_fkey" FOREIGN KEY ("promo_id") REFERENCES "promos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promo_package_components" ADD CONSTRAINT "promo_package_components_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promo_package_component_versions" ADD CONSTRAINT "promo_package_component_versions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['promo_packages', 'promo_package_components', 'promo_package_component_versions']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (public.bypass_rls() OR organization_id = public.current_org_id()) WITH CHECK (public.bypass_rls() OR organization_id = public.current_org_id())', table_name);
  END LOOP;
END $$;
