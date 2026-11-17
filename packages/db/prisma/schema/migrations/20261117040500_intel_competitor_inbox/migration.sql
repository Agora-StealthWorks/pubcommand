-- CreateTable
CREATE TABLE "intel_competitors" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "products" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "websites" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sender_addresses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sender_domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "intel_competitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intel_emails" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "competitor_id" UUID,
    "matched_by" TEXT,
    "source" TEXT NOT NULL,
    "gmail_account_id" UUID,
    "gmail_message_id" TEXT,
    "message_id" TEXT,
    "dedupe_key" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "from_name" TEXT,
    "from_address" TEXT NOT NULL,
    "to_address" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL,
    "html_body" TEXT,
    "text_body" TEXT NOT NULL DEFAULT '',
    "snippet" TEXT NOT NULL DEFAULT '',
    "links" JSONB NOT NULL DEFAULT '[]',
    "landing_url" TEXT,
    "placement" TEXT,
    "raw" BYTEA,
    "raw_size" INTEGER NOT NULL DEFAULT 0,
    "email_type" TEXT,
    "extraction_status" TEXT NOT NULL DEFAULT 'NONE',
    "extraction_error" TEXT,
    "extraction" JSONB,
    "extraction_model" TEXT,
    "extracted_at" TIMESTAMP(3),
    "analyzer_promo_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "intel_emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intel_gmail_accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "refresh_token_enc" TEXT NOT NULL,
    "access_token_enc" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "query" TEXT,
    "history_id" TEXT,
    "sync_status" TEXT NOT NULL DEFAULT 'IDLE',
    "last_sync_at" TIMESTAMP(3),
    "last_sync_error" TEXT,
    "last_sync_added" INTEGER NOT NULL DEFAULT 0,
    "connected_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intel_gmail_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intel_radar_digests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "week_start" DATE NOT NULL,
    "summary" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NONE',
    "error" TEXT,
    "narrative" JSONB,
    "model" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intel_radar_digests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "intel_competitors_organization_id_brand_id_idx" ON "intel_competitors"("organization_id", "brand_id");

-- CreateIndex
CREATE INDEX "intel_emails_organization_id_brand_id_received_at_idx" ON "intel_emails"("organization_id", "brand_id", "received_at");

-- CreateIndex
CREATE INDEX "intel_emails_organization_id_brand_id_competitor_id_idx" ON "intel_emails"("organization_id", "brand_id", "competitor_id");

-- CreateIndex
CREATE INDEX "intel_emails_organization_id_extraction_status_idx" ON "intel_emails"("organization_id", "extraction_status");

-- CreateIndex
CREATE UNIQUE INDEX "intel_emails_brand_id_dedupe_key_key" ON "intel_emails"("brand_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "intel_gmail_accounts_organization_id_idx" ON "intel_gmail_accounts"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "intel_gmail_accounts_brand_id_email_key" ON "intel_gmail_accounts"("brand_id", "email");

-- CreateIndex
CREATE INDEX "intel_radar_digests_organization_id_brand_id_idx" ON "intel_radar_digests"("organization_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "intel_radar_digests_brand_id_week_start_key" ON "intel_radar_digests"("brand_id", "week_start");

-- AddForeignKey
ALTER TABLE "intel_emails" ADD CONSTRAINT "intel_emails_competitor_id_fkey" FOREIGN KEY ("competitor_id") REFERENCES "intel_competitors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intel_emails" ADD CONSTRAINT "intel_emails_gmail_account_id_fkey" FOREIGN KEY ("gmail_account_id") REFERENCES "intel_gmail_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Organization and brand foreign keys (added by hand; no relation fields on shared models).
ALTER TABLE "intel_competitors" ADD CONSTRAINT "intel_competitors_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "intel_competitors" ADD CONSTRAINT "intel_competitors_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "intel_emails" ADD CONSTRAINT "intel_emails_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "intel_emails" ADD CONSTRAINT "intel_emails_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "intel_gmail_accounts" ADD CONSTRAINT "intel_gmail_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "intel_gmail_accounts" ADD CONSTRAINT "intel_gmail_accounts_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "intel_radar_digests" ADD CONSTRAINT "intel_radar_digests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "intel_radar_digests" ADD CONSTRAINT "intel_radar_digests_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security: tenant isolation.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['intel_competitors', 'intel_emails', 'intel_gmail_accounts', 'intel_radar_digests']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (public.bypass_rls() OR organization_id = public.current_org_id()) WITH CHECK (public.bypass_rls() OR organization_id = public.current_org_id())', table_name);
  END LOOP;
END $$;
