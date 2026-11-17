-- CreateEnum
CREATE TYPE "FormStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "FormResponseStatus" AS ENUM ('PARTIAL', 'COMPLETE');

-- CreateEnum
CREATE TYPE "FormSummaryStatus" AS ENUM ('RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "form_themes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "logo_file_id" UUID,
    "logo_url" TEXT,
    "logo_link_url" TEXT,
    "logo_height" INTEGER,
    "header_size" TEXT NOT NULL DEFAULT 'standard',
    "bar_color" TEXT NOT NULL DEFAULT '#0b1220',
    "accent_color" TEXT NOT NULL DEFAULT '#1d4ed8',
    "privacy_policy_url" TEXT NOT NULL,
    "company_name" TEXT NOT NULL DEFAULT '',
    "footer_text" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "form_themes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_folders" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "default_theme_id" UUID,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forms" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "folder_id" UUID,
    "theme_id" UUID,
    "title" TEXT NOT NULL,
    "internal_name" TEXT,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "FormStatus" NOT NULL DEFAULT 'DRAFT',
    "opens_at" TIMESTAMP(3),
    "closes_at" TIMESTAMP(3),
    "response_limit" INTEGER,
    "layout" TEXT NOT NULL DEFAULT 'paginated',
    "show_progress" BOOLEAN NOT NULL DEFAULT true,
    "auto_advance" BOOLEAN NOT NULL DEFAULT true,
    "submit_label" TEXT NOT NULL DEFAULT 'Submit',
    "confirm_title" TEXT NOT NULL DEFAULT 'Thank you!',
    "confirm_message" TEXT NOT NULL DEFAULT 'Your response has been recorded.',
    "redirect_url" TEXT,
    "closed_message" TEXT NOT NULL DEFAULT 'This form is not taking responses right now.',
    "disclaimer_override" TEXT,
    "brain_sync_enabled" BOOLEAN NOT NULL DEFAULT true,
    "published_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_fields" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "help_text" TEXT NOT NULL DEFAULT '',
    "placeholder" TEXT NOT NULL DEFAULT '',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL DEFAULT '{}',
    "visibility" JSONB,
    "skip_logic" JSONB,
    "group_with_next" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_responses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "status" "FormResponseStatus" NOT NULL DEFAULT 'PARTIAL',
    "resume_token" TEXT NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "last_page_index" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER,
    "ip_hash" TEXT,
    "user_agent" TEXT,
    "referrer" TEXT,
    "utm" JSONB,
    "spam_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_files" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "form_id" UUID,
    "response_id" UUID,
    "field_id" UUID,
    "kind" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_summaries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "status" "FormSummaryStatus" NOT NULL DEFAULT 'RUNNING',
    "error" TEXT,
    "model" TEXT,
    "result" JSONB,
    "response_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "form_themes_organization_id_brand_id_idx" ON "form_themes"("organization_id", "brand_id");

-- CreateIndex
CREATE INDEX "form_folders_organization_id_brand_id_idx" ON "form_folders"("organization_id", "brand_id");

-- CreateIndex
CREATE INDEX "forms_organization_id_brand_id_updated_at_idx" ON "forms"("organization_id", "brand_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "forms_organization_id_slug_key" ON "forms"("organization_id", "slug");

-- CreateIndex
CREATE INDEX "form_fields_organization_id_form_id_position_idx" ON "form_fields"("organization_id", "form_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "form_responses_resume_token_key" ON "form_responses"("resume_token");

-- CreateIndex
CREATE INDEX "form_responses_organization_id_form_id_status_completed_at_idx" ON "form_responses"("organization_id", "form_id", "status", "completed_at");

-- CreateIndex
CREATE INDEX "form_responses_organization_id_form_id_started_at_idx" ON "form_responses"("organization_id", "form_id", "started_at");

-- CreateIndex
CREATE INDEX "form_files_organization_id_form_id_idx" ON "form_files"("organization_id", "form_id");

-- CreateIndex
CREATE INDEX "form_files_organization_id_response_id_idx" ON "form_files"("organization_id", "response_id");

-- CreateIndex
CREATE INDEX "form_summaries_organization_id_form_id_created_at_idx" ON "form_summaries"("organization_id", "form_id", "created_at");

-- AddForeignKey
ALTER TABLE "form_folders" ADD CONSTRAINT "form_folders_default_theme_id_fkey" FOREIGN KEY ("default_theme_id") REFERENCES "form_themes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forms" ADD CONSTRAINT "forms_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "form_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forms" ADD CONSTRAINT "forms_theme_id_fkey" FOREIGN KEY ("theme_id") REFERENCES "form_themes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_fields" ADD CONSTRAINT "form_fields_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_files" ADD CONSTRAINT "form_files_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_files" ADD CONSTRAINT "form_files_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "form_responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_summaries" ADD CONSTRAINT "form_summaries_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Foreign keys to shared tables (no Prisma relation fields, to keep shared schema files untouched).
ALTER TABLE "form_themes" ADD CONSTRAINT "form_themes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "form_themes" ADD CONSTRAINT "form_themes_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "form_folders" ADD CONSTRAINT "form_folders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "form_folders" ADD CONSTRAINT "form_folders_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "forms" ADD CONSTRAINT "forms_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "forms" ADD CONSTRAINT "forms_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "form_fields" ADD CONSTRAINT "form_fields_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "form_files" ADD CONSTRAINT "form_files_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "form_summaries" ADD CONSTRAINT "form_summaries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['form_themes', 'form_folders', 'forms', 'form_fields', 'form_responses', 'form_files', 'form_summaries']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (public.bypass_rls() OR organization_id = public.current_org_id()) WITH CHECK (public.bypass_rls() OR organization_id = public.current_org_id())', table_name);
  END LOOP;
END $$;
