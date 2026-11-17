-- Funnels: microsites (block-built home page), hosts, pages & links, deadline bar
-- and design tokens. Additive only.

-- AlterTable
ALTER TABLE "funnels" ADD COLUMN     "deadline_bar_at" TIMESTAMP(3),
ADD COLUMN     "deadline_bar_bg" TEXT NOT NULL DEFAULT '#b42318',
ADD COLUMN     "deadline_bar_color" TEXT NOT NULL DEFAULT '#ffffff',
ADD COLUMN     "deadline_bar_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "deadline_bar_position" TEXT NOT NULL DEFAULT 'bottom',
ADD COLUMN     "deadline_bar_sticky" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "deadline_bar_target" TEXT NOT NULL DEFAULT 'end',
ADD COLUMN     "deadline_bar_text" TEXT NOT NULL DEFAULT 'This offer ends in',
ADD COLUMN     "deadline_bar_within_hours" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "design" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "design_draft" JSONB,
ADD COLUMN     "home_blocks" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "home_blocks_draft" JSONB,
ADD COLUMN     "home_shell" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "home_title" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "hosts_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hosts_title" TEXT NOT NULL DEFAULT 'Meet your hosts',
ADD COLUMN     "site_type" TEXT NOT NULL DEFAULT 'launch';

-- CreateTable
CREATE TABLE "funnel_hosts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "funnel_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "bio_html" TEXT NOT NULL DEFAULT '',
    "photo_asset_id" UUID,
    "photo_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funnel_hosts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funnel_nav_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "funnel_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'page',
    "label" TEXT NOT NULL DEFAULT '',
    "slug" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "content_mode" TEXT NOT NULL DEFAULT 'rich',
    "title_placement" TEXT NOT NULL DEFAULT 'outside',
    "body_html" TEXT NOT NULL DEFAULT '',
    "html" TEXT NOT NULL DEFAULT '',
    "optin_mode" TEXT NOT NULL DEFAULT 'none',
    "optin_form_slug" TEXT,
    "url" TEXT NOT NULL DEFAULT '',
    "new_tab" BOOLEAN NOT NULL DEFAULT true,
    "show_in_nav" BOOLEAN NOT NULL DEFAULT true,
    "show_lock" BOOLEAN NOT NULL DEFAULT true,
    "faded" BOOLEAN NOT NULL DEFAULT true,
    "show_in_agenda" BOOLEAN NOT NULL DEFAULT false,
    "agenda_when" TEXT NOT NULL DEFAULT '',
    "agenda_desc" TEXT NOT NULL DEFAULT '',
    "after_module" INTEGER,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "thumb_asset_id" UUID,
    "thumb_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funnel_nav_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "funnel_hosts_organization_id_funnel_id_position_idx" ON "funnel_hosts"("organization_id", "funnel_id", "position");

-- CreateIndex
CREATE INDEX "funnel_nav_items_organization_id_funnel_id_sort_idx" ON "funnel_nav_items"("organization_id", "funnel_id", "sort");

-- AddForeignKey
ALTER TABLE "funnel_hosts" ADD CONSTRAINT "funnel_hosts_funnel_id_fkey" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funnel_nav_items" ADD CONSTRAINT "funnel_nav_items_funnel_id_fkey" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant foreign keys (no relation fields on shared models).
ALTER TABLE "funnel_hosts" ADD CONSTRAINT "funnel_hosts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "funnel_nav_items" ADD CONSTRAINT "funnel_nav_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['funnel_hosts', 'funnel_nav_items']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (public.bypass_rls() OR organization_id = public.current_org_id()) WITH CHECK (public.bypass_rls() OR organization_id = public.current_org_id())', table_name);
  END LOOP;
END $$;
