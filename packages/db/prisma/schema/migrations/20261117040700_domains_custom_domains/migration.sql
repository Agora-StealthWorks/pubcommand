-- CreateEnum
CREATE TYPE "CustomDomainStatus" AS ENUM ('PENDING_DNS', 'VERIFYING', 'ACTIVE', 'ERROR');

-- CreateEnum
CREATE TYPE "CustomDomainProvider" AS ENUM ('CLOUDFLARE_PURCHASED', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "DomainPurchaseResult" AS ENUM ('STARTED', 'PENDING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "custom_domains" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID,
    "hostname" TEXT NOT NULL,
    "target_path" TEXT NOT NULL,
    "target_label" TEXT,
    "status" "CustomDomainStatus" NOT NULL DEFAULT 'PENDING_DNS',
    "provider" "CustomDomainProvider" NOT NULL DEFAULT 'EXTERNAL',
    "redirect_to_host" TEXT,
    "railway_domain_id" TEXT,
    "cloudflare_zone_id" TEXT,
    "dns_records" JSONB NOT NULL DEFAULT '[]',
    "last_checked_at" TIMESTAMP(3),
    "error" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domain_purchases" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID,
    "domain" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "years" INTEGER NOT NULL DEFAULT 1,
    "result" "DomainPurchaseResult" NOT NULL DEFAULT 'STARTED',
    "registrar_status" TEXT,
    "workflow_url" TEXT,
    "payment_reference" TEXT,
    "sandbox" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "response" JSONB,
    "actor_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "domain_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "custom_domains_hostname_key" ON "custom_domains"("hostname");

-- CreateIndex
CREATE INDEX "custom_domains_organization_id_created_at_idx" ON "custom_domains"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "domain_purchases_organization_id_created_at_idx" ON "domain_purchases"("organization_id", "created_at");

-- Hostnames are stored lowercased; enforce it so a raw insert cannot dodge the unique index.
ALTER TABLE "custom_domains" ADD CONSTRAINT "custom_domains_hostname_lower" CHECK ("hostname" = lower("hostname"));

-- AddForeignKey (by hand: no relation fields on Organization/Brand/User)
ALTER TABLE "custom_domains" ADD CONSTRAINT "custom_domains_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "custom_domains" ADD CONSTRAINT "custom_domains_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "domain_purchases" ADD CONSTRAINT "domain_purchases_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "domain_purchases" ADD CONSTRAINT "domain_purchases_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Give the new domains.manage permission to the existing owner/admin roles that already manage settings.
INSERT INTO "role_permissions" ("id", "organization_id", "role_id", "permission", "effect")
SELECT gen_random_uuid(), rp."organization_id", rp."role_id", 'domains.manage', 'ALLOW'
FROM "role_permissions" rp
JOIN "roles" r ON r."id" = rp."role_id"
WHERE rp."permission" = 'settings.manage' AND rp."effect" = 'ALLOW' AND r."slug" IN ('owner', 'admin')
ON CONFLICT ("role_id", "permission") DO NOTHING;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['custom_domains', 'domain_purchases']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (public.bypass_rls() OR organization_id = public.current_org_id()) WITH CHECK (public.bypass_rls() OR organization_id = public.current_org_id())', table_name);
  END LOOP;
END $$;
