-- Wiki + Testimonials. Additive only: four new tables, plan entitlements and role grants.
-- The Wiki has no tables of its own (it displays Publication Setup).

-- CreateTable
CREATE TABLE "testimonials" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "publication_id" UUID,
    "editor_id" UUID,
    "display_name" TEXT NOT NULL,
    "location" TEXT,
    "quote" TEXT NOT NULL,
    "body" TEXT,
    "result_claimed" TEXT,
    "given_on" DATE,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "rating" INTEGER,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "video_url" TEXT,
    "contact_email" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "review_reason" TEXT,
    "disclosure" TEXT,
    "flags" JSONB,
    "flag_count" INTEGER NOT NULL DEFAULT 0,
    "ai_status" TEXT NOT NULL DEFAULT 'none',
    "ai_reason" TEXT,
    "ai_flags" JSONB,
    "consent_given" BOOLEAN NOT NULL DEFAULT false,
    "consent_text" TEXT,
    "consent_at" TIMESTAMP(3),
    "consent_method" TEXT,
    "consent_ip_hash" TEXT,
    "capture_link_id" UUID,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "testimonials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "testimonial_files" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "testimonial_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'screenshot',
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "testimonial_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "testimonial_views" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "testimonial_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "testimonial_capture_links" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "publication_id" UUID,
    "token" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "intro" TEXT,
    "consent_text" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "testimonial_capture_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "testimonials_organization_id_brand_id_status_idx" ON "testimonials"("organization_id", "brand_id", "status");

-- CreateIndex
CREATE INDEX "testimonials_brand_id_publication_id_idx" ON "testimonials"("brand_id", "publication_id");

-- CreateIndex
CREATE INDEX "testimonials_brand_id_editor_id_idx" ON "testimonials"("brand_id", "editor_id");

-- CreateIndex
CREATE INDEX "testimonial_files_organization_id_testimonial_id_idx" ON "testimonial_files"("organization_id", "testimonial_id");

-- CreateIndex
CREATE INDEX "testimonial_views_organization_id_brand_id_idx" ON "testimonial_views"("organization_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "testimonial_capture_links_token_key" ON "testimonial_capture_links"("token");

-- CreateIndex
CREATE INDEX "testimonial_capture_links_organization_id_brand_id_idx" ON "testimonial_capture_links"("organization_id", "brand_id");

-- AddForeignKey
ALTER TABLE "testimonial_files" ADD CONSTRAINT "testimonial_files_testimonial_id_fkey" FOREIGN KEY ("testimonial_id") REFERENCES "testimonials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Foreign keys to shared and Publication Setup tables (added by hand, like every app).
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "calendar_publications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_editor_id_fkey" FOREIGN KEY ("editor_id") REFERENCES "pubsetup_editors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_capture_link_id_fkey" FOREIGN KEY ("capture_link_id") REFERENCES "testimonial_capture_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "testimonial_files" ADD CONSTRAINT "testimonial_files_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "testimonial_views" ADD CONSTRAINT "testimonial_views_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "testimonial_views" ADD CONSTRAINT "testimonial_views_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "testimonial_capture_links" ADD CONSTRAINT "testimonial_capture_links_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "testimonial_capture_links" ADD CONSTRAINT "testimonial_capture_links_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "testimonial_capture_links" ADD CONSTRAINT "testimonial_capture_links_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "calendar_publications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['testimonials', 'testimonial_files', 'testimonial_views', 'testimonial_capture_links']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (public.bypass_rls() OR organization_id = public.current_org_id()) WITH CHECK (public.bypass_rls() OR organization_id = public.current_org_id())', table_name);
  END LOOP;
END $$;

-- The Wiki goes wherever Publication Setup is (every default plan); Testimonials to the paid ones.
INSERT INTO "plan_modules" ("plan_id", "module_id")
SELECT p."id", 'wiki' FROM "plans" p WHERE p."key" IN ('internal', 'enterprise', 'pro', 'starter')
ON CONFLICT DO NOTHING;

INSERT INTO "plan_modules" ("plan_id", "module_id")
SELECT p."id", 'testimonials' FROM "plans" p WHERE p."key" IN ('internal', 'enterprise', 'pro')
ON CONFLICT DO NOTHING;

-- Every existing role may read the wiki.
INSERT INTO "role_permissions" ("id", "organization_id", "role_id", "permission", "effect")
SELECT gen_random_uuid(), r."organization_id", r."id", 'wiki.read', 'ALLOW'
FROM "roles" r
ON CONFLICT ("role_id", "permission") DO NOTHING;

-- Owners and admins get the three Testimonials permissions.
INSERT INTO "role_permissions" ("id", "organization_id", "role_id", "permission", "effect")
SELECT gen_random_uuid(), r."organization_id", r."id", perm.permission, 'ALLOW'
FROM "roles" r
CROSS JOIN (VALUES ('testimonials.read'), ('testimonials.write'), ('testimonials.approve')) AS perm(permission)
WHERE r."slug" IN ('owner', 'admin')
ON CONFLICT ("role_id", "permission") DO NOTHING;
