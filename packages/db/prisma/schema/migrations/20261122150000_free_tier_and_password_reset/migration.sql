-- Password reset links share the magic_links table. Each token now carries a
-- purpose so a reset link can never be used to sign in, and a sign-in link can
-- never reset a password. Existing rows are sign-in/invite links.
ALTER TABLE "magic_links" ADD COLUMN IF NOT EXISTS "purpose" TEXT NOT NULL DEFAULT 'login';

-- The funnel tier "Free / lead gen" is now called "Free" (Publication Setup).
UPDATE "calendar_publications" SET "tier" = 'Free' WHERE "tier" = 'Free / lead gen';

-- Organization email: each organization can connect its own Resend account (Settings → Email)
-- and set senders per brand and per publication. The API key is stored encrypted.
CREATE TABLE IF NOT EXISTS "org_email_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "resend_key_cipher" TEXT,
    "resend_key_hint" TEXT,
    "key_connected_at" TIMESTAMP(3),
    "from_name" TEXT,
    "from_address" TEXT,
    "reply_to" TEXT,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "org_email_settings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "org_email_settings_organization_id_key" ON "org_email_settings"("organization_id");
ALTER TABLE "org_email_settings" ADD CONSTRAINT "org_email_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "email_senders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "owner_type" TEXT NOT NULL,
    "owner_id" UUID NOT NULL,
    "from_name" TEXT,
    "from_address" TEXT,
    "reply_to" TEXT,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "email_senders_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "email_senders_organization_id_owner_type_owner_id_key" ON "email_senders"("organization_id", "owner_type", "owner_id");
ALTER TABLE "email_senders" ADD CONSTRAINT "email_senders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['org_email_settings', 'email_senders']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (public.bypass_rls() OR organization_id = public.current_org_id()) WITH CHECK (public.bypass_rls() OR organization_id = public.current_org_id())', table_name);
  END LOOP;
END $$;
