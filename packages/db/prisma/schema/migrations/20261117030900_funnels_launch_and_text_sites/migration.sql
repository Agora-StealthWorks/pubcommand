-- Funnels: launch funnels and text-letter sites. Additive only.

-- CreateTable
CREATE TABLE "funnels" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "mode" TEXT NOT NULL DEFAULT 'evergreen',
    "timing" TEXT NOT NULL DEFAULT 'fixed',
    "start_at" TIMESTAMP(3),
    "end_at" TIMESTAMP(3),
    "close_after_hours" INTEGER,
    "livestream_url" TEXT,
    "progression" TEXT NOT NULL DEFAULT 'all_open',
    "watch_percent" INTEGER NOT NULL DEFAULT 80,
    "build_mode" TEXT NOT NULL DEFAULT 'as_you_go',
    "close_mode" TEXT NOT NULL DEFAULT 'page',
    "close_headline" TEXT NOT NULL DEFAULT 'This event has closed',
    "close_message_html" TEXT NOT NULL DEFAULT '<p>Thanks for your interest. This event is no longer available.</p>',
    "close_button_text" TEXT,
    "close_button_url" TEXT,
    "close_redirect_url" TEXT,
    "waitlist_enabled" BOOLEAN NOT NULL DEFAULT true,
    "waitlist_headline" TEXT NOT NULL DEFAULT 'It starts in…',
    "waitlist_subheadline" TEXT NOT NULL DEFAULT 'Keep this page open. You will be taken in automatically the moment it begins.',
    "agenda_title" TEXT NOT NULL DEFAULT 'Agenda',
    "optin_mode" TEXT NOT NULL DEFAULT 'none',
    "optin_form_slug" TEXT,
    "optin_headline" TEXT NOT NULL DEFAULT 'Get a reminder before we start',
    "optin_button_text" TEXT NOT NULL DEFAULT 'Remind me',
    "form_theme_id" UUID,
    "logo_asset_id" UUID,
    "logo_url" TEXT,
    "logo_height" INTEGER NOT NULL DEFAULT 40,
    "header_bg" TEXT NOT NULL DEFAULT '#111827',
    "page_bg" TEXT NOT NULL DEFAULT '#f5f6f8',
    "text_color" TEXT NOT NULL DEFAULT '#1f2937',
    "accent_color" TEXT NOT NULL DEFAULT '#1d4ed8',
    "company_name" TEXT NOT NULL DEFAULT '',
    "privacy_url" TEXT,
    "terms_url" TEXT,
    "footer_html" TEXT NOT NULL DEFAULT '',
    "locked_title" TEXT NOT NULL DEFAULT 'This video is locked',
    "locked_scheduled_msg" TEXT NOT NULL DEFAULT '{day} unlocks on {unlock_date}. Check back then!',
    "locked_watch_msg" TEXT NOT NULL DEFAULT 'Watch at least {percent}% of {prev_day} to unlock {day}.',
    "locked_key_msg" TEXT NOT NULL DEFAULT '{day} unlocks from the link in your email.',
    "locked_live_msg" TEXT NOT NULL DEFAULT '{day} goes live on {unlock_date}.',
    "coming_soon_title" TEXT NOT NULL DEFAULT 'Coming soon',
    "coming_soon_message" TEXT NOT NULL DEFAULT 'This video will be available shortly. Check back soon!',
    "replay_pending_title" TEXT NOT NULL DEFAULT 'The replay is on its way',
    "replay_pending_message" TEXT NOT NULL DEFAULT 'The live session has ended. The replay will be posted here shortly.',
    "live_headline" TEXT NOT NULL DEFAULT 'We''re live!',
    "live_subheadline" TEXT NOT NULL DEFAULT 'Taking you to the livestream room…',
    "next_button_text" TEXT NOT NULL DEFAULT 'Watch the next day',
    "brain_sync_enabled" BOOLEAN NOT NULL DEFAULT true,
    "published_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "funnels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funnel_days" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "funnel_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "nav_label" TEXT,
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "body_html" TEXT NOT NULL DEFAULT '',
    "video_provider" TEXT,
    "video_id" TEXT,
    "video_title" TEXT,
    "video_thumb_url" TEXT,
    "video_duration" INTEGER,
    "thumb_asset_id" UUID,
    "thumb_url" TEXT,
    "unlock_offset_hours" INTEGER NOT NULL DEFAULT 0,
    "unlock_at" TIMESTAMP(3),
    "unlock_key" TEXT NOT NULL,
    "is_live" BOOLEAN NOT NULL DEFAULT false,
    "live_start_at" TIMESTAMP(3),
    "live_end_at" TIMESTAMP(3),
    "live_url" TEXT,
    "live_override" TEXT NOT NULL DEFAULT 'auto',
    "resources_heading" TEXT NOT NULL DEFAULT 'Resources',
    "resources" JSONB NOT NULL DEFAULT '[]',
    "cta_reveal" TEXT NOT NULL DEFAULT 'none',
    "cta_text" TEXT NOT NULL DEFAULT '',
    "cta_url" TEXT NOT NULL DEFAULT '',
    "cta_seconds" INTEGER NOT NULL DEFAULT 0,
    "cta_at" TIMESTAMP(3),
    "cta_subtext" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funnel_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funnel_assets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "funnel_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funnel_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "funnel_id" UUID NOT NULL,
    "day_id" UUID,
    "kind" TEXT NOT NULL,
    "visitor_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "funnel_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funnel_watches" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "funnel_id" UUID NOT NULL,
    "day_id" UUID NOT NULL,
    "visitor_id" TEXT NOT NULL,
    "percent" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funnel_watches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funnel_optins" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "funnel_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "consent_text" TEXT NOT NULL,
    "ip_hash" TEXT,
    "page_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "funnel_optins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "text_sites" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "tagline" TEXT NOT NULL DEFAULT '',
    "intro_html" TEXT NOT NULL DEFAULT '',
    "program_name" TEXT NOT NULL DEFAULT '',
    "company_name" TEXT NOT NULL DEFAULT '',
    "message_frequency" TEXT NOT NULL DEFAULT 'Message frequency varies',
    "help_contact" TEXT NOT NULL DEFAULT '',
    "privacy_url" TEXT,
    "terms_url" TEXT,
    "logo_asset_id" UUID,
    "logo_url" TEXT,
    "logo_height" INTEGER NOT NULL DEFAULT 36,
    "header_bg" TEXT NOT NULL DEFAULT '#111827',
    "accent_color" TEXT NOT NULL DEFAULT '#1d4ed8',
    "archives_enabled" BOOLEAN NOT NULL DEFAULT true,
    "calendar_code" TEXT,
    "brain_sync_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "text_sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "text_posts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publish_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "body_html" TEXT NOT NULL DEFAULT '',
    "action_to_take" TEXT,
    "button_text" TEXT,
    "button_url" TEXT,
    "calendar_issue_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "text_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "text_optins" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "consent_text" TEXT NOT NULL,
    "ip_hash" TEXT,
    "page_url" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "text_optins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "text_views" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "post_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "text_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "funnels_organization_id_brand_id_updated_at_idx" ON "funnels"("organization_id", "brand_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "funnels_organization_id_slug_key" ON "funnels"("organization_id", "slug");

-- CreateIndex
CREATE INDEX "funnel_days_organization_id_funnel_id_position_idx" ON "funnel_days"("organization_id", "funnel_id", "position");

-- CreateIndex
CREATE INDEX "funnel_assets_organization_id_owner_id_idx" ON "funnel_assets"("organization_id", "owner_id");

-- CreateIndex
CREATE INDEX "funnel_events_organization_id_funnel_id_created_at_idx" ON "funnel_events"("organization_id", "funnel_id", "created_at");

-- CreateIndex
CREATE INDEX "funnel_watches_organization_id_funnel_id_idx" ON "funnel_watches"("organization_id", "funnel_id");

-- CreateIndex
CREATE UNIQUE INDEX "funnel_watches_funnel_id_day_id_visitor_id_key" ON "funnel_watches"("funnel_id", "day_id", "visitor_id");

-- CreateIndex
CREATE INDEX "funnel_optins_organization_id_funnel_id_created_at_idx" ON "funnel_optins"("organization_id", "funnel_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "funnel_optins_funnel_id_email_key" ON "funnel_optins"("funnel_id", "email");

-- CreateIndex
CREATE INDEX "text_sites_organization_id_brand_id_updated_at_idx" ON "text_sites"("organization_id", "brand_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "text_sites_organization_id_slug_key" ON "text_sites"("organization_id", "slug");

-- CreateIndex
CREATE INDEX "text_posts_organization_id_site_id_publish_at_idx" ON "text_posts"("organization_id", "site_id", "publish_at");

-- CreateIndex
CREATE UNIQUE INDEX "text_posts_site_id_slug_key" ON "text_posts"("site_id", "slug");

-- CreateIndex
CREATE INDEX "text_optins_organization_id_site_id_created_at_idx" ON "text_optins"("organization_id", "site_id", "created_at");

-- CreateIndex
CREATE INDEX "text_optins_site_id_phone_idx" ON "text_optins"("site_id", "phone");

-- CreateIndex
CREATE INDEX "text_views_organization_id_site_id_created_at_idx" ON "text_views"("organization_id", "site_id", "created_at");

-- CreateIndex
CREATE INDEX "text_views_post_id_idx" ON "text_views"("post_id");

-- AddForeignKey
ALTER TABLE "funnel_days" ADD CONSTRAINT "funnel_days_funnel_id_fkey" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funnel_events" ADD CONSTRAINT "funnel_events_funnel_id_fkey" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funnel_watches" ADD CONSTRAINT "funnel_watches_funnel_id_fkey" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funnel_optins" ADD CONSTRAINT "funnel_optins_funnel_id_fkey" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "text_posts" ADD CONSTRAINT "text_posts_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "text_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "text_optins" ADD CONSTRAINT "text_optins_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "text_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "text_views" ADD CONSTRAINT "text_views_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "text_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "text_views" ADD CONSTRAINT "text_views_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "text_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Organization and brand foreign keys (added by hand; no relation fields on shared models).
ALTER TABLE "funnels" ADD CONSTRAINT "funnels_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "funnel_days" ADD CONSTRAINT "funnel_days_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "funnel_assets" ADD CONSTRAINT "funnel_assets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "funnel_events" ADD CONSTRAINT "funnel_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "funnel_watches" ADD CONSTRAINT "funnel_watches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "funnel_optins" ADD CONSTRAINT "funnel_optins_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "text_sites" ADD CONSTRAINT "text_sites_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "text_posts" ADD CONSTRAINT "text_posts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "text_optins" ADD CONSTRAINT "text_optins_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "text_views" ADD CONSTRAINT "text_views_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "funnels" ADD CONSTRAINT "funnels_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "text_sites" ADD CONSTRAINT "text_sites_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Entitle the existing internal, enterprise and pro plans to Funnels.
INSERT INTO "plan_modules" ("plan_id", "module_id")
SELECT p."id", 'funnels' FROM "plans" p WHERE p."key" IN ('internal', 'enterprise', 'pro')
ON CONFLICT DO NOTHING;

-- Give the three Funnels permissions to the existing owner and admin roles.
INSERT INTO "role_permissions" ("id", "organization_id", "role_id", "permission", "effect")
SELECT gen_random_uuid(), r."organization_id", r."id", perm.permission, 'ALLOW'
FROM "roles" r
CROSS JOIN (VALUES ('funnels.read'), ('funnels.write'), ('funnels.publish')) AS perm(permission)
WHERE r."slug" IN ('owner', 'admin')
ON CONFLICT ("role_id", "permission") DO NOTHING;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['funnels', 'funnel_days', 'funnel_assets', 'funnel_events', 'funnel_watches', 'funnel_optins', 'text_sites', 'text_posts', 'text_optins', 'text_views']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (public.bypass_rls() OR organization_id = public.current_org_id()) WITH CHECK (public.bypass_rls() OR organization_id = public.current_org_id())', table_name);
  END LOOP;
END $$;
