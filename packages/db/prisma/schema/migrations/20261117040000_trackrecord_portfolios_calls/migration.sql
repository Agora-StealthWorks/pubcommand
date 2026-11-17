-- Track Record (module performance): portfolios, recommendations, quotes and the call archive.

-- CreateTable
CREATE TABLE "track_portfolios" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "publication" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "public_token" TEXT,
    "public_enabled" BOOLEAN NOT NULL DEFAULT false,
    "public_include_open" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 100,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "track_portfolios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "track_positions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "portfolio_id" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "asset_type" TEXT NOT NULL DEFAULT 'STOCK',
    "direction" TEXT NOT NULL DEFAULT 'LONG',
    "option_right" TEXT,
    "strike" DOUBLE PRECISION,
    "expiry" DATE,
    "price_symbol" TEXT,
    "entry_date" DATE NOT NULL,
    "entry_price" DOUBLE PRECISION NOT NULL,
    "stop_price" DOUBLE PRECISION,
    "target_price" DOUBLE PRECISION,
    "exit_date" DATE,
    "exit_price" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "notes" TEXT NOT NULL DEFAULT '',
    "split_factor" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "split_source" TEXT NOT NULL DEFAULT 'none',
    "peak_price" DOUBLE PRECISION,
    "peak_date" DATE,
    "peak_checked_at" TIMESTAMP(3),
    "recorded_price" DOUBLE PRECISION,
    "recorded_at" TIMESTAMP(3),
    "import_batch" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "track_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "track_quotes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "price" DOUBLE PRECISION,
    "as_of" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT '',
    "error" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "track_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "track_experts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "bio" TEXT NOT NULL DEFAULT '',
    "sort_order" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "track_experts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "track_categories" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#2563eb',
    "description" TEXT NOT NULL DEFAULT '',
    "sort_order" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "track_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "track_calls" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "expert_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "ticker" TEXT,
    "price_symbol" TEXT,
    "call_type" TEXT NOT NULL DEFAULT 'Recommendation',
    "direction" TEXT NOT NULL DEFAULT 'LONG',
    "call_date" DATE,
    "source" TEXT NOT NULL DEFAULT '',
    "gain_basis" TEXT NOT NULL DEFAULT 'TODAY',
    "entry_price" DOUBLE PRECISION,
    "exit_price" DOUBLE PRECISION,
    "exit_date" DATE,
    "recorded_peak" DOUBLE PRECISION,
    "recorded_peak_at" DATE,
    "recorded_price" DOUBLE PRECISION,
    "recorded_at" DATE,
    "split_factor" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "split_source" TEXT NOT NULL DEFAULT 'none',
    "market_peak" DOUBLE PRECISION,
    "market_peak_at" DATE,
    "peak_checked_at" TIMESTAMP(3),
    "category_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "key_quote" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "track_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "track_call_files" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "call_id" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'BACKUP',
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "track_call_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "track_portfolios_public_token_key" ON "track_portfolios"("public_token");

-- CreateIndex
CREATE INDEX "track_portfolios_organization_id_brand_id_deleted_at_idx" ON "track_portfolios"("organization_id", "brand_id", "deleted_at");

-- CreateIndex
CREATE INDEX "track_positions_organization_id_brand_id_deleted_at_idx" ON "track_positions"("organization_id", "brand_id", "deleted_at");

-- CreateIndex
CREATE INDEX "track_positions_portfolio_id_status_deleted_at_idx" ON "track_positions"("portfolio_id", "status", "deleted_at");

-- CreateIndex
CREATE INDEX "track_positions_price_symbol_idx" ON "track_positions"("price_symbol");

-- CreateIndex
CREATE UNIQUE INDEX "track_quotes_organization_id_symbol_key" ON "track_quotes"("organization_id", "symbol");

-- CreateIndex
CREATE INDEX "track_experts_organization_id_brand_id_deleted_at_idx" ON "track_experts"("organization_id", "brand_id", "deleted_at");

-- CreateIndex
CREATE INDEX "track_categories_organization_id_brand_id_idx" ON "track_categories"("organization_id", "brand_id");

-- CreateIndex
CREATE INDEX "track_calls_organization_id_brand_id_expert_id_deleted_at_idx" ON "track_calls"("organization_id", "brand_id", "expert_id", "deleted_at");

-- CreateIndex
CREATE INDEX "track_calls_organization_id_ticker_idx" ON "track_calls"("organization_id", "ticker");

-- CreateIndex
CREATE INDEX "track_call_files_call_id_idx" ON "track_call_files"("call_id");

-- AddForeignKey
ALTER TABLE "track_positions" ADD CONSTRAINT "track_positions_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "track_portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "track_calls" ADD CONSTRAINT "track_calls_expert_id_fkey" FOREIGN KEY ("expert_id") REFERENCES "track_experts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "track_call_files" ADD CONSTRAINT "track_call_files_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "track_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Organization and brand foreign keys (added by hand: no relation fields on shared models).
ALTER TABLE "track_portfolios" ADD CONSTRAINT "track_portfolios_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "track_portfolios" ADD CONSTRAINT "track_portfolios_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "track_positions" ADD CONSTRAINT "track_positions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "track_positions" ADD CONSTRAINT "track_positions_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "track_quotes" ADD CONSTRAINT "track_quotes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "track_experts" ADD CONSTRAINT "track_experts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "track_experts" ADD CONSTRAINT "track_experts_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "track_categories" ADD CONSTRAINT "track_categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "track_categories" ADD CONSTRAINT "track_categories_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "track_calls" ADD CONSTRAINT "track_calls_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "track_calls" ADD CONSTRAINT "track_calls_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "track_call_files" ADD CONSTRAINT "track_call_files_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security: tenant isolation.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['track_portfolios', 'track_positions', 'track_quotes', 'track_experts', 'track_categories', 'track_calls', 'track_call_files']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (public.bypass_rls() OR organization_id = public.current_org_id()) WITH CHECK (public.bypass_rls() OR organization_id = public.current_org_id())', table_name);
  END LOOP;
END $$;
