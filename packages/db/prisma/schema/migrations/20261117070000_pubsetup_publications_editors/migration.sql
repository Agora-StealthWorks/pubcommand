-- Publication Setup (module id "pubsetup") becomes the owner of publications, editors
-- and branding. Additive only: calendar_publications keeps every existing column and
-- row (issues, send stats and Mini-Blog keep reading it); new columns are nullable or
-- defaulted. The Prisma model moved from marketing-calendar.prisma to pubsetup.prisma.

-- AlterTable
ALTER TABLE "calendar_publications" ADD COLUMN     "accent_color" TEXT,
ADD COLUMN     "archive_url" TEXT,
ADD COLUMN     "audience" TEXT,
ADD COLUMN     "background_color" TEXT,
ADD COLUMN     "body_font" TEXT,
ADD COLUMN     "compliance_notes" TEXT,
ADD COLUMN     "cover_data" BYTEA,
ADD COLUMN     "cover_filename" TEXT,
ADD COLUMN     "cover_mime" TEXT,
ADD COLUMN     "created_by_id" UUID,
ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "deliverables" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "email_header_data" BYTEA,
ADD COLUMN     "email_header_filename" TEXT,
ADD COLUMN     "email_header_mime" TEXT,
ADD COLUMN     "facts" JSONB,
ADD COLUMN     "footer_text" TEXT,
ADD COLUMN     "frequency" TEXT,
ADD COLUMN     "heading_font" TEXT,
ADD COLUMN     "launch_date" DATE,
ADD COLUMN     "long_description" TEXT,
ADD COLUMN     "offers" JSONB,
ADD COLUMN     "positioning" TEXT,
ADD COLUMN     "primary_color" TEXT,
ADD COLUMN     "pub_type" TEXT,
ADD COLUMN     "sample_issues" JSONB,
ADD COLUMN     "sender_email" TEXT,
ADD COLUMN     "sender_name" TEXT,
ADD COLUMN     "signup_url" TEXT,
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active',
ADD COLUMN     "tagline" TEXT,
ADD COLUMN     "text_color" TEXT,
ADD COLUMN     "tier" TEXT,
ADD COLUMN     "updated_by_id" UUID,
ADD COLUMN     "voice_notes" TEXT,
ADD COLUMN     "website_url" TEXT;

-- CreateTable
CREATE TABLE "pubsetup_editors" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT,
    "short_bio" TEXT,
    "long_bio" TEXT,
    "credentials" TEXT,
    "track_record" TEXT,
    "specialties" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "social_links" JSONB,
    "voice_notes" TEXT,
    "email" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "photo_filename" TEXT,
    "photo_mime" TEXT,
    "photo_data" BYTEA,
    "facts" JSONB,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "pubsetup_editors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pubsetup_publication_editors" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "publication_id" UUID NOT NULL,
    "editor_id" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'lead',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pubsetup_publication_editors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pubsetup_brand_branding" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "tagline" TEXT,
    "primary_color" TEXT,
    "accent_color" TEXT,
    "text_color" TEXT,
    "background_color" TEXT,
    "heading_font" TEXT,
    "body_font" TEXT,
    "logo_filename" TEXT,
    "logo_mime" TEXT,
    "logo_data" BYTEA,
    "email_header_filename" TEXT,
    "email_header_mime" TEXT,
    "email_header_data" BYTEA,
    "sender_name" TEXT,
    "sender_email" TEXT,
    "footer_text" TEXT,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pubsetup_brand_branding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pubsetup_editors_organization_id_brand_id_idx" ON "pubsetup_editors"("organization_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "pubsetup_editors_brand_id_slug_key" ON "pubsetup_editors"("brand_id", "slug");

-- CreateIndex
CREATE INDEX "pubsetup_publication_editors_organization_id_editor_id_idx" ON "pubsetup_publication_editors"("organization_id", "editor_id");

-- CreateIndex
CREATE UNIQUE INDEX "pubsetup_publication_editors_publication_id_editor_id_key" ON "pubsetup_publication_editors"("publication_id", "editor_id");

-- CreateIndex
CREATE UNIQUE INDEX "pubsetup_brand_branding_brand_id_key" ON "pubsetup_brand_branding"("brand_id");

-- CreateIndex
CREATE INDEX "pubsetup_brand_branding_organization_id_idx" ON "pubsetup_brand_branding"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_publications_brand_id_slug_key" ON "calendar_publications"("brand_id", "slug");

-- AddForeignKey
ALTER TABLE "pubsetup_publication_editors" ADD CONSTRAINT "pubsetup_publication_editors_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "calendar_publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pubsetup_publication_editors" ADD CONSTRAINT "pubsetup_publication_editors_editor_id_fkey" FOREIGN KEY ("editor_id") REFERENCES "pubsetup_editors"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Foreign keys to shared tables (added by hand, like every app).
ALTER TABLE "pubsetup_editors" ADD CONSTRAINT "pubsetup_editors_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pubsetup_editors" ADD CONSTRAINT "pubsetup_editors_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pubsetup_publication_editors" ADD CONSTRAINT "pubsetup_publication_editors_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pubsetup_brand_branding" ADD CONSTRAINT "pubsetup_brand_branding_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pubsetup_brand_branding" ADD CONSTRAINT "pubsetup_brand_branding_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every existing publication gets a URL slug from its code (unique per brand)
-- and a status that matches its old active flag. No other existing value changes.
WITH base AS (
  SELECT "id", "brand_id",
         COALESCE(NULLIF(trim(both '-' from regexp_replace(lower("code"), '[^a-z0-9]+', '-', 'g')), ''), 'publication') AS b,
         "created_at"
  FROM "calendar_publications" WHERE "slug" IS NULL
), ranked AS (
  SELECT "id", b, row_number() OVER (PARTITION BY "brand_id", b ORDER BY "created_at", "id") AS n FROM base
)
UPDATE "calendar_publications" p
SET "slug" = CASE WHEN r.n = 1 THEN r.b ELSE r.b || '-' || r.n END
FROM ranked r WHERE p."id" = r."id";

UPDATE "calendar_publications" SET "status" = 'retired' WHERE "active" = false AND "status" = 'active';

-- Row-level security on the new tables (calendar_publications already has it).
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['pubsetup_editors', 'pubsetup_publication_editors', 'pubsetup_brand_branding']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (public.bypass_rls() OR organization_id = public.current_org_id()) WITH CHECK (public.bypass_rls() OR organization_id = public.current_org_id())', table_name);
  END LOOP;
END $$;

-- Add the module to the default plans that already carry the Marketing Calendar.
INSERT INTO "plan_modules" ("plan_id", "module_id")
SELECT p."id", 'pubsetup' FROM "plans" p WHERE p."key" IN ('internal', 'enterprise', 'pro', 'starter')
ON CONFLICT DO NOTHING;

-- Admin-only: give pubsetup.manage to the existing owner and admin roles, nobody else.
INSERT INTO "role_permissions" ("id", "organization_id", "role_id", "permission", "effect")
SELECT gen_random_uuid(), r."organization_id", r."id", 'pubsetup.manage', 'ALLOW'
FROM "roles" r
WHERE r."slug" IN ('owner', 'admin')
ON CONFLICT ("role_id", "permission") DO NOTHING;
