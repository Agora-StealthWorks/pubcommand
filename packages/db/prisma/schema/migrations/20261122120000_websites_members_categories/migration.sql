-- Website members log in with a password; emailed links only set or reset it. A session
-- records how it was opened, so only a fresh link session may skip the current password.
ALTER TABLE "web_member_sessions" ADD COLUMN "method" TEXT NOT NULL DEFAULT 'link';

-- Publication categories (Publication Setup) and a FAQ per publication. Additive only:
-- pub_type is kept as it is (the internal funnel rule still reads it); people now see the category.

-- CreateTable
CREATE TABLE "pubsetup_categories" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pubsetup_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pubsetup_categories_organization_id_brand_id_idx" ON "pubsetup_categories"("organization_id", "brand_id");

-- AlterTable
ALTER TABLE "calendar_publications" ADD COLUMN "category_id" UUID;
ALTER TABLE "calendar_publications" ADD COLUMN "faq" JSONB;

-- AddForeignKey
ALTER TABLE "calendar_publications" ADD CONSTRAINT "calendar_publications_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "pubsetup_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Foreign keys to shared tables (added by hand, like every app).
ALTER TABLE "pubsetup_categories" ADD CONSTRAINT "pubsetup_categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pubsetup_categories" ADD CONSTRAINT "pubsetup_categories_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security, like the neighbouring Publication Setup tables.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['pubsetup_categories']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (public.bypass_rls() OR organization_id = public.current_org_id()) WITH CHECK (public.bypass_rls() OR organization_id = public.current_org_id())', table_name);
  END LOOP;
END $$;

-- seed:begin
-- Seed categories from the Types each brand already uses (same names, editable later) and put
-- each publication in its Type's category, so nothing is ungrouped on deploy. Idempotent:
-- a category is only created when the brand has none with that name (any case), and only
-- publications without a category are assigned. Order follows the old Type list.
INSERT INTO "pubsetup_categories" ("id", "organization_id", "brand_id", "name", "sort_order", "created_at", "updated_at")
SELECT gen_random_uuid(), t."organization_id", t."brand_id", t."name",
       COALESCE(array_position(ARRAY['Free newsletter','Paid newsletter','Premium service','Alert service','Text letter (SMS)','Membership','Course','Podcast or video','Live events','Other'], t."name"), 100) * 10,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT ON (p."brand_id", lower(btrim(p."pub_type"))) p."organization_id", p."brand_id", btrim(p."pub_type") AS "name"
  FROM "calendar_publications" p
  WHERE p."pub_type" IS NOT NULL AND btrim(p."pub_type") <> ''
  ORDER BY p."brand_id", lower(btrim(p."pub_type")), p."created_at"
) t
WHERE NOT EXISTS (
  SELECT 1 FROM "pubsetup_categories" c WHERE c."brand_id" = t."brand_id" AND lower(c."name") = lower(t."name")
);

UPDATE "calendar_publications" p
SET "category_id" = c."id"
FROM "pubsetup_categories" c
WHERE p."category_id" IS NULL
  AND p."pub_type" IS NOT NULL
  AND c."brand_id" = p."brand_id"
  AND lower(c."name") = lower(btrim(p."pub_type"));
-- seed:end
