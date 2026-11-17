-- Publication Setup: retail pricing fields and a second logo slot. Additive only.
-- logo_* stays the logo for LIGHT backgrounds (dark artwork); logo_on_dark_* is the
-- logo for DARK backgrounds (light artwork). logo_sorted is false for logos uploaded
-- before the slots existed: the app checks their artwork once and moves a light logo
-- into the dark-background slot. The email branding columns stay (no longer edited).

-- AlterTable
ALTER TABLE "calendar_publications" ADD COLUMN     "retail_price" TEXT,
ADD COLUMN     "lifetime_price" TEXT,
ADD COLUMN     "sale_price" TEXT,
ADD COLUMN     "pricing_notes" TEXT,
ADD COLUMN     "logo_on_dark_filename" TEXT,
ADD COLUMN     "logo_on_dark_mime" TEXT,
ADD COLUMN     "logo_on_dark_data" BYTEA,
ADD COLUMN     "logo_sorted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "pubsetup_brand_branding" ADD COLUMN     "logo_on_dark_filename" TEXT,
ADD COLUMN     "logo_on_dark_mime" TEXT,
ADD COLUMN     "logo_on_dark_data" BYTEA,
ADD COLUMN     "logo_sorted" BOOLEAN NOT NULL DEFAULT false;
