-- Logo size in brand and publication branding; form themes and Mini-Blogs can follow the brand look.
ALTER TABLE "pubsetup_brand_branding" ADD COLUMN "logo_size" TEXT;
ALTER TABLE "calendar_publications" ADD COLUMN "logo_size" TEXT;
ALTER TABLE "form_themes" ADD COLUMN "follow_brand" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "text_sites" ADD COLUMN "follow_brand" BOOLEAN NOT NULL DEFAULT false;

-- Themes and Mini-Blogs nobody styled (still the factory look, no logo), or already in the
-- brand's colors, follow the brand from now on. Customized ones keep their own look.
UPDATE "form_themes" t SET "follow_brand" = true
WHERE t."deleted_at" IS NULL AND t."logo_file_id" IS NULL AND COALESCE(t."logo_url", '') = ''
  AND (
    (lower(t."bar_color") = '#0b1220' AND lower(t."accent_color") = '#1d4ed8')
    OR EXISTS (SELECT 1 FROM "pubsetup_brand_branding" b WHERE b."brand_id" = t."brand_id" AND lower(b."primary_color") = lower(t."bar_color") AND lower(COALESCE(b."accent_color", '#1d4ed8')) = lower(t."accent_color"))
  );
UPDATE "form_themes" t SET "follow_brand" = true
WHERE t."deleted_at" IS NULL AND t."logo_file_id" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "pubsetup_brand_branding" b WHERE b."brand_id" = t."brand_id" AND lower(b."primary_color") = lower(t."bar_color") AND lower(COALESCE(b."accent_color", '#1d4ed8')) = lower(t."accent_color"));

UPDATE "text_sites" s SET "follow_brand" = true
WHERE s."deleted_at" IS NULL AND (
    (s."logo_asset_id" IS NULL AND COALESCE(s."logo_url", '') = '' AND lower(s."header_bg") = '#111827' AND lower(s."accent_color") = '#1d4ed8')
    OR EXISTS (SELECT 1 FROM "pubsetup_brand_branding" b WHERE b."brand_id" = s."brand_id" AND lower(b."primary_color") = lower(s."header_bg") AND lower(COALESCE(b."accent_color", '#1d4ed8')) = lower(s."accent_color"))
  );
