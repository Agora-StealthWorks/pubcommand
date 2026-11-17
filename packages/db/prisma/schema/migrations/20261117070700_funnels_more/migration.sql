-- Funnels: invites & reminders, SMS forms, delegates, favicon, header/footer
-- code, deadline-bar pages/button/dismiss, bot flagging. Mini-Blog: tracked
-- links. Additive only.

-- AlterTable
ALTER TABLE "funnel_days" ADD COLUMN     "sms_form_id" UUID;

-- AlterTable
ALTER TABLE "funnel_events" ADD COLUMN     "bot_reason" TEXT;

-- AlterTable
ALTER TABLE "funnel_nav_items" ADD COLUMN     "sms_form_id" UUID;

-- AlterTable
ALTER TABLE "funnel_optins" ADD COLUMN     "unsubscribed_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "funnels" ADD COLUMN     "deadline_bar_button_text" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "deadline_bar_button_url" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "deadline_bar_dismiss" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "deadline_bar_pages" TEXT[] DEFAULT ARRAY['home', 'waitlist', 'day', 'custom']::TEXT[],
ADD COLUMN     "email_from_name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "email_reply_to" TEXT,
ADD COLUMN     "favicon_asset_id" UUID,
ADD COLUMN     "favicon_url" TEXT,
ADD COLUMN     "footer_code" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "head_code" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "optin_sms_form_id" UUID;

-- CreateTable
CREATE TABLE "funnel_emails" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "funnel_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "offset_minutes" INTEGER NOT NULL DEFAULT 0,
    "subject" TEXT NOT NULL DEFAULT '',
    "body_html" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funnel_emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funnel_email_sends" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "funnel_id" UUID NOT NULL,
    "email_id" UUID NOT NULL,
    "optin_id" UUID NOT NULL,
    "session_key" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "funnel_email_sends_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funnel_sms_forms" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "funnel_id" UUID NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'SMS signup',
    "headline" TEXT NOT NULL DEFAULT 'Get text alerts',
    "intro_html" TEXT NOT NULL DEFAULT '',
    "collect_email" BOOLEAN NOT NULL DEFAULT false,
    "phone_placeholder" TEXT NOT NULL DEFAULT 'Mobile number',
    "button_text" TEXT NOT NULL DEFAULT 'Sign me up',
    "success_message" TEXT NOT NULL DEFAULT 'You''re in. Watch your phone for a confirmation text.',
    "company_name" TEXT NOT NULL DEFAULT '',
    "program_name" TEXT NOT NULL DEFAULT '',
    "message_frequency" TEXT NOT NULL DEFAULT 'Message frequency varies',
    "help_contact" TEXT NOT NULL DEFAULT '',
    "privacy_url" TEXT,
    "terms_url" TEXT,
    "custom_consent" TEXT NOT NULL DEFAULT '',
    "box_bg" TEXT NOT NULL DEFAULT '#111827',
    "text_color" TEXT NOT NULL DEFAULT '#ffffff',
    "button_bg" TEXT NOT NULL DEFAULT '#1d4ed8',
    "button_color" TEXT NOT NULL DEFAULT '#ffffff',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funnel_sms_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funnel_sms_optins" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "funnel_id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "consent_text" TEXT NOT NULL,
    "ip_hash" TEXT,
    "page_url" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "funnel_sms_optins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funnel_delegates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "funnel_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "added_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "funnel_delegates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "text_links" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "text_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "text_link_clicks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "link_id" UUID NOT NULL,
    "bot_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "text_link_clicks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "funnel_emails_organization_id_funnel_id_idx" ON "funnel_emails"("organization_id", "funnel_id");

-- CreateIndex
CREATE INDEX "funnel_email_sends_organization_id_funnel_id_created_at_idx" ON "funnel_email_sends"("organization_id", "funnel_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "funnel_email_sends_email_id_optin_id_session_key_key" ON "funnel_email_sends"("email_id", "optin_id", "session_key");

-- CreateIndex
CREATE INDEX "funnel_sms_forms_organization_id_funnel_id_idx" ON "funnel_sms_forms"("organization_id", "funnel_id");

-- CreateIndex
CREATE INDEX "funnel_sms_optins_organization_id_funnel_id_created_at_idx" ON "funnel_sms_optins"("organization_id", "funnel_id", "created_at");

-- CreateIndex
CREATE INDEX "funnel_sms_optins_form_id_phone_idx" ON "funnel_sms_optins"("form_id", "phone");

-- CreateIndex
CREATE INDEX "funnel_delegates_organization_id_user_id_idx" ON "funnel_delegates"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "funnel_delegates_funnel_id_user_id_key" ON "funnel_delegates"("funnel_id", "user_id");

-- CreateIndex
CREATE INDEX "text_links_organization_id_site_id_idx" ON "text_links"("organization_id", "site_id");

-- CreateIndex
CREATE UNIQUE INDEX "text_links_post_id_url_key" ON "text_links"("post_id", "url");

-- CreateIndex
CREATE INDEX "text_link_clicks_organization_id_post_id_created_at_idx" ON "text_link_clicks"("organization_id", "post_id", "created_at");

-- CreateIndex
CREATE INDEX "text_link_clicks_link_id_idx" ON "text_link_clicks"("link_id");

-- AddForeignKey
ALTER TABLE "funnel_emails" ADD CONSTRAINT "funnel_emails_funnel_id_fkey" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funnel_email_sends" ADD CONSTRAINT "funnel_email_sends_funnel_id_fkey" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funnel_email_sends" ADD CONSTRAINT "funnel_email_sends_email_id_fkey" FOREIGN KEY ("email_id") REFERENCES "funnel_emails"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funnel_email_sends" ADD CONSTRAINT "funnel_email_sends_optin_id_fkey" FOREIGN KEY ("optin_id") REFERENCES "funnel_optins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funnel_sms_forms" ADD CONSTRAINT "funnel_sms_forms_funnel_id_fkey" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funnel_sms_optins" ADD CONSTRAINT "funnel_sms_optins_funnel_id_fkey" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funnel_sms_optins" ADD CONSTRAINT "funnel_sms_optins_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "funnel_sms_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funnel_delegates" ADD CONSTRAINT "funnel_delegates_funnel_id_fkey" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "text_links" ADD CONSTRAINT "text_links_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "text_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "text_links" ADD CONSTRAINT "text_links_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "text_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "text_link_clicks" ADD CONSTRAINT "text_link_clicks_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "text_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Foreign keys to shared tables (no relation fields on Organization/User).
ALTER TABLE "funnel_emails" ADD CONSTRAINT "funnel_emails_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "funnel_email_sends" ADD CONSTRAINT "funnel_email_sends_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "funnel_sms_forms" ADD CONSTRAINT "funnel_sms_forms_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "funnel_sms_optins" ADD CONSTRAINT "funnel_sms_optins_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "funnel_delegates" ADD CONSTRAINT "funnel_delegates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "funnel_delegates" ADD CONSTRAINT "funnel_delegates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "text_links" ADD CONSTRAINT "text_links_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "text_link_clicks" ADD CONSTRAINT "text_link_clicks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['funnel_emails', 'funnel_email_sends', 'funnel_sms_forms', 'funnel_sms_optins', 'funnel_delegates', 'text_links', 'text_link_clicks']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (public.bypass_rls() OR organization_id = public.current_org_id()) WITH CHECK (public.bypass_rls() OR organization_id = public.current_org_id())', table_name);
  END LOOP;
END $$;
