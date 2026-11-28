-- Funnels: tracked URL parameters, set per organization and inherited by every funnel.
-- All additive: existing events and opt-ins keep a null params column.
ALTER TABLE "funnel_events" ADD COLUMN "params" JSONB;
ALTER TABLE "funnel_optins" ADD COLUMN "params" JSONB;
ALTER TABLE "funnel_sms_optins" ADD COLUMN "params" JSONB;

CREATE TABLE "funnels_settings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "tracked_params" TEXT[] DEFAULT ARRAY['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']::TEXT[],
    "attribution" TEXT NOT NULL DEFAULT 'first',
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "funnels_settings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "funnels_settings_organization_id_key" ON "funnels_settings"("organization_id");
ALTER TABLE "funnels_settings" ADD CONSTRAINT "funnels_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "funnels_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "funnels_settings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "funnels_settings";
CREATE POLICY tenant_isolation ON "funnels_settings" USING (public.bypass_rls() OR organization_id = public.current_org_id()) WITH CHECK (public.bypass_rls() OR organization_id = public.current_org_id());
