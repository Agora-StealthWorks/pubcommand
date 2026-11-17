-- Forms: more field types, end rules, notifications, public results, schedule, mirror.

-- AlterTable
ALTER TABLE "form_responses" ADD COLUMN     "confirmation_sent_at" TIMESTAMP(3),
ADD COLUMN     "mirror_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "mirror_error" TEXT,
ADD COLUMN     "mirror_status" TEXT,
ADD COLUMN     "mirror_tried_at" TIMESTAMP(3),
ADD COLUMN     "notified_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "forms" ADD COLUMN     "auto_publish" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "confirm_email_body" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "confirm_email_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "confirm_email_field_id" UUID,
ADD COLUMN     "confirm_email_subject" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "end_rules" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "notify_digest_sent_at" TIMESTAMP(3),
ADD COLUMN     "notify_include_answers" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notify_mode" TEXT NOT NULL DEFAULT 'off',
ADD COLUMN     "notify_user_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "public_results_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "public_results_min" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "schedule_note" TEXT;

-- CreateTable
CREATE TABLE "form_mirrors" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "target" JSONB NOT NULL DEFAULT '{}',
    "secret_cipher" TEXT NOT NULL,
    "last_error" TEXT,
    "last_synced_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_mirrors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "form_mirrors_form_id_key" ON "form_mirrors"("form_id");

-- CreateIndex
CREATE INDEX "form_mirrors_organization_id_idx" ON "form_mirrors"("organization_id");

-- CreateIndex
CREATE INDEX "form_responses_organization_id_mirror_status_idx" ON "form_responses"("organization_id", "mirror_status");

-- CreateIndex
CREATE INDEX "form_responses_organization_id_notified_at_idx" ON "form_responses"("organization_id", "notified_at");

-- AddForeignKey
ALTER TABLE "form_mirrors" ADD CONSTRAINT "form_mirrors_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "form_mirrors" ADD CONSTRAINT "form_mirrors_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['form_mirrors']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (public.bypass_rls() OR organization_id = public.current_org_id()) WITH CHECK (public.bypass_rls() OR organization_id = public.current_org_id())', table_name);
  END LOOP;
END $$;
