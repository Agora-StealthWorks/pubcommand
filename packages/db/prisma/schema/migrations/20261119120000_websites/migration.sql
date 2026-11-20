-- Websites app: public website + members site CMS (modules/websites).
-- Additive only: new web_* tables, plan/role rows. Nothing existing is changed.

-- CreateTable
CREATE TABLE "web_sites" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "tagline" TEXT NOT NULL DEFAULT '',
    "logo_asset_id" UUID,
    "logo_light_asset_id" UUID,
    "icon_asset_id" UUID,
    "logo_height" INTEGER NOT NULL DEFAULT 88,
    "theme" JSONB NOT NULL DEFAULT '{}',
    "menu" JSONB NOT NULL DEFAULT '[]',
    "topics" JSONB NOT NULL DEFAULT '[]',
    "footer_text" TEXT NOT NULL DEFAULT '',
    "disclaimer" TEXT NOT NULL DEFAULT '',
    "signup_publication_id" UUID,
    "show_ticker" BOOLEAN NOT NULL DEFAULT true,
    "ticker_text" TEXT NOT NULL DEFAULT '',
    "support_email" TEXT,
    "created_by_id" UUID,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "web_sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "web_posts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'post',
    "title" TEXT NOT NULL DEFAULT '',
    "slug" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL DEFAULT '',
    "body_html" TEXT NOT NULL DEFAULT '',
    "featured_asset_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "published_at" TIMESTAMP(3),
    "publication_id" UUID,
    "content_type" TEXT NOT NULL DEFAULT 'article',
    "access" TEXT NOT NULL DEFAULT 'public',
    "teaser_blocks" INTEGER NOT NULL DEFAULT 2,
    "author_editor_id" UUID,
    "author_name" TEXT NOT NULL DEFAULT '',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "seo_title" TEXT NOT NULL DEFAULT '',
    "seo_description" TEXT NOT NULL DEFAULT '',
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "web_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "web_terms" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "web_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "web_post_terms" (
    "organization_id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "term_id" UUID NOT NULL,

    CONSTRAINT "web_post_terms_pkey" PRIMARY KEY ("post_id","term_id")
);

-- CreateTable
CREATE TABLE "web_assets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "alt" TEXT NOT NULL DEFAULT '',
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "web_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "web_products" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL DEFAULT '',
    "price_label" TEXT NOT NULL DEFAULT '',
    "publication_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "all_publications" BOOLEAN NOT NULL DEFAULT false,
    "offer_url" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "web_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "web_members" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "web_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "web_entitlements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'active',
    "starts_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMP(3),
    "reference" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "granted_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "web_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "web_signups" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "member_id" UUID,
    "email" TEXT NOT NULL,
    "publication_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'subscribed',
    "source" TEXT NOT NULL DEFAULT '',
    "ip_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "web_signups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "web_member_tokens" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "web_member_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "web_member_sessions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "web_member_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "web_sites_organization_id_brand_id_idx" ON "web_sites"("organization_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "web_sites_organization_id_slug_key" ON "web_sites"("organization_id", "slug");

-- CreateIndex
CREATE INDEX "web_posts_organization_id_site_id_kind_status_published_at_idx" ON "web_posts"("organization_id", "site_id", "kind", "status", "published_at");

-- CreateIndex
CREATE INDEX "web_posts_site_id_publication_id_published_at_idx" ON "web_posts"("site_id", "publication_id", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "web_posts_site_id_slug_key" ON "web_posts"("site_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "web_terms_site_id_kind_slug_key" ON "web_terms"("site_id", "kind", "slug");

-- CreateIndex
CREATE INDEX "web_post_terms_term_id_idx" ON "web_post_terms"("term_id");

-- CreateIndex
CREATE INDEX "web_assets_organization_id_site_id_created_at_idx" ON "web_assets"("organization_id", "site_id", "created_at");

-- CreateIndex
CREATE INDEX "web_products_organization_id_site_id_idx" ON "web_products"("organization_id", "site_id");

-- CreateIndex
CREATE INDEX "web_members_organization_id_site_id_created_at_idx" ON "web_members"("organization_id", "site_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "web_members_site_id_email_key" ON "web_members"("site_id", "email");

-- CreateIndex
CREATE INDEX "web_entitlements_member_id_idx" ON "web_entitlements"("member_id");

-- CreateIndex
CREATE INDEX "web_entitlements_product_id_idx" ON "web_entitlements"("product_id");

-- CreateIndex
CREATE INDEX "web_signups_organization_id_site_id_publication_id_created__idx" ON "web_signups"("organization_id", "site_id", "publication_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "web_signups_site_id_email_publication_id_key" ON "web_signups"("site_id", "email", "publication_id");

-- CreateIndex
CREATE UNIQUE INDEX "web_member_tokens_token_hash_key" ON "web_member_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "web_member_tokens_member_id_created_at_idx" ON "web_member_tokens"("member_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "web_member_sessions_token_hash_key" ON "web_member_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "web_member_sessions_member_id_idx" ON "web_member_sessions"("member_id");

-- AddForeignKey
ALTER TABLE "web_posts" ADD CONSTRAINT "web_posts_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "web_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_terms" ADD CONSTRAINT "web_terms_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "web_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_post_terms" ADD CONSTRAINT "web_post_terms_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "web_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_post_terms" ADD CONSTRAINT "web_post_terms_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "web_terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_assets" ADD CONSTRAINT "web_assets_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "web_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_products" ADD CONSTRAINT "web_products_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "web_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_members" ADD CONSTRAINT "web_members_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "web_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_entitlements" ADD CONSTRAINT "web_entitlements_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "web_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_entitlements" ADD CONSTRAINT "web_entitlements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "web_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_signups" ADD CONSTRAINT "web_signups_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "web_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_member_tokens" ADD CONSTRAINT "web_member_tokens_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "web_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_member_sessions" ADD CONSTRAINT "web_member_sessions_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "web_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Foreign keys to shared tables (no relation fields in the shared schema files).
ALTER TABLE "web_sites" ADD CONSTRAINT "web_sites_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "web_sites" ADD CONSTRAINT "web_sites_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['web_sites', 'web_posts', 'web_terms', 'web_post_terms', 'web_assets', 'web_products', 'web_members', 'web_entitlements', 'web_signups', 'web_member_tokens', 'web_member_sessions']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (public.bypass_rls() OR organization_id = public.current_org_id()) WITH CHECK (public.bypass_rls() OR organization_id = public.current_org_id())', table_name);
  END LOOP;
END $$;

-- Add the app to the plans that carry Mini-Blog.
INSERT INTO "plan_modules" ("plan_id", "module_id")
SELECT p."id", 'websites' FROM "plans" p WHERE p."key" IN ('internal', 'enterprise', 'pro')
ON CONFLICT DO NOTHING;

-- Give the Websites permissions to the existing owner and admin roles.
INSERT INTO "role_permissions" ("id", "organization_id", "role_id", "permission", "effect")
SELECT gen_random_uuid(), r."organization_id", r."id", perm.permission, 'ALLOW'
FROM "roles" r
CROSS JOIN (VALUES ('websites.read'), ('websites.write'), ('websites.publish'), ('websites.members')) AS perm(permission)
WHERE r."slug" IN ('owner', 'admin')
ON CONFLICT ("role_id", "permission") DO NOTHING;
