-- ChartBuilder: bot API keys and call log, compare-line bars and file tokens on charts. Additive only.

-- AlterTable
ALTER TABLE "charts" ADD COLUMN "api_key_id" UUID,
ADD COLUMN "compare_bars" JSONB,
ADD COLUMN "file_token" TEXT;

-- CreateTable
CREATE TABLE "chart_api_keys" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "scopes" TEXT[],
    "rate_limit" INTEGER NOT NULL DEFAULT 60,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_by_id" UUID,
    CONSTRAINT "chart_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chart_api_calls" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "key_id" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "chart_id" UUID,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chart_api_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chart_api_keys_key_hash_key" ON "chart_api_keys"("key_hash");
CREATE INDEX "chart_api_keys_organization_id_brand_id_revoked_at_idx" ON "chart_api_keys"("organization_id", "brand_id", "revoked_at");
CREATE INDEX "chart_api_calls_key_id_created_at_idx" ON "chart_api_calls"("key_id", "created_at");
CREATE INDEX "chart_api_calls_organization_id_created_at_idx" ON "chart_api_calls"("organization_id", "created_at");
CREATE UNIQUE INDEX "charts_file_token_key" ON "charts"("file_token");

-- AddForeignKey
ALTER TABLE "chart_api_calls" ADD CONSTRAINT "chart_api_calls_key_id_fkey" FOREIGN KEY ("key_id") REFERENCES "chart_api_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant foreign keys (no Prisma relations on shared models).
ALTER TABLE "chart_api_keys" ADD CONSTRAINT "chart_api_keys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chart_api_keys" ADD CONSTRAINT "chart_api_keys_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chart_api_calls" ADD CONSTRAINT "chart_api_calls_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "charts" ADD CONSTRAINT "charts_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "chart_api_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-level security for the new tenant tables.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['chart_api_keys', 'chart_api_calls']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (public.bypass_rls() OR organization_id = public.current_org_id()) WITH CHECK (public.bypass_rls() OR organization_id = public.current_org_id())', table_name);
  END LOOP;
END $$;
