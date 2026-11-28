-- Funnels: docuseries episode pages. All additive with defaults, so existing funnels look and behave the same.
-- Episode access window (expiring modules), countdown style, locked-box look, sidebar navigation,
-- and an offer section (blocks) under module pages.
ALTER TABLE "funnels" ADD COLUMN "access_hours" INTEGER;
ALTER TABLE "funnels" ADD COLUMN "locked_expired_msg" TEXT NOT NULL DEFAULT '{day} is no longer available. Get full access to watch every episode any time.';
ALTER TABLE "funnels" ADD COLUMN "countdown_style" TEXT NOT NULL DEFAULT 'boxes';
ALTER TABLE "funnels" ADD COLUMN "countdown_zero" TEXT NOT NULL DEFAULT 'reload';
ALTER TABLE "funnels" ADD COLUMN "locked_box_bg" TEXT;
ALTER TABLE "funnels" ADD COLUMN "locked_box_text" TEXT;
ALTER TABLE "funnels" ADD COLUMN "locked_box_minimal" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "funnels" ADD COLUMN "nav_layout" TEXT NOT NULL DEFAULT 'strip';
ALTER TABLE "funnels" ADD COLUMN "nav_blur_locked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "funnels" ADD COLUMN "offer_blocks" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "funnels" ADD COLUMN "offer_blocks_draft" JSONB;
ALTER TABLE "funnel_days" ADD COLUMN "access_hours" INTEGER;
ALTER TABLE "funnel_days" ADD COLUMN "show_offer" BOOLEAN NOT NULL DEFAULT true;
