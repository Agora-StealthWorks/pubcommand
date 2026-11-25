-- Mini-Blog: everything the OxfordHub T-Letter site had, plus mediums, themes and ad zones.
-- Additive only. Existing Mini-Blogs keep their look ("classic") and stay SMS.

ALTER TABLE "text_sites" ADD COLUMN "medium" TEXT NOT NULL DEFAULT 'SMS';
ALTER TABLE "text_sites" ADD COLUMN "theme" TEXT NOT NULL DEFAULT 'classic';
ALTER TABLE "text_sites" ADD COLUMN "post_categories" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "text_sites" ADD COLUMN "ad_codes" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "text_posts" ADD COLUMN "action_secondary" TEXT;
ALTER TABLE "text_posts" ADD COLUMN "category" TEXT;
ALTER TABLE "text_posts" ADD COLUMN "tickers" TEXT;
ALTER TABLE "text_posts" ADD COLUMN "top_ad" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "text_posts" ADD COLUMN "top_ad_text" TEXT;
ALTER TABLE "text_posts" ADD COLUMN "top_ad_link" TEXT;
ALTER TABLE "text_posts" ADD COLUMN "content_ad" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "text_posts" ADD COLUMN "content_ad_text" TEXT;
ALTER TABLE "text_posts" ADD COLUMN "content_ad_link" TEXT;

ALTER TABLE "text_optins" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'sms';
ALTER TABLE "text_optins" ADD COLUMN "email" TEXT;
ALTER TABLE "text_optins" ALTER COLUMN "phone" DROP NOT NULL;

ALTER TABLE "text_views" ADD COLUMN "visitor_id" TEXT;
CREATE INDEX "text_views_post_id_visitor_id_idx" ON "text_views"("post_id", "visitor_id");

ALTER TABLE "text_links" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'content';
-- The action button's link was stored with the other links; mark it as the CTA.
UPDATE "text_links" l SET "kind" = 'cta'
FROM "text_posts" p
WHERE p."id" = l."post_id" AND p."button_url" IS NOT NULL AND btrim(p."button_url") = l."url";

ALTER TABLE "text_link_clicks" ADD COLUMN "visitor_id" TEXT;

CREATE TABLE "miniblog_settings" (
    "organization_id" UUID NOT NULL,
    "mediums" TEXT[] DEFAULT ARRAY['Email', 'SMS', 'Push Notification']::TEXT[],
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "miniblog_settings_pkey" PRIMARY KEY ("organization_id")
);
ALTER TABLE "miniblog_settings" ADD CONSTRAINT "miniblog_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "miniblog_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "miniblog_settings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "miniblog_settings";
CREATE POLICY tenant_isolation ON "miniblog_settings" USING (public.bypass_rls() OR organization_id = public.current_org_id()) WITH CHECK (public.bypass_rls() OR organization_id = public.current_org_id());
