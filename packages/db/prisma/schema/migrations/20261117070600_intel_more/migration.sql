-- Intel: video capture, landing pages, registries (experts, lists, topics) and digest settings. Additive only.

-- AlterTable
ALTER TABLE "intel_emails" ADD COLUMN     "landing_page_id" UUID;

-- CreateTable
CREATE TABLE "intel_videos" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "competitor_id" UUID,
    "matched_by" TEXT,
    "url" TEXT NOT NULL,
    "media_url" TEXT,
    "platform" TEXT,
    "title" TEXT,
    "uploader" TEXT,
    "duration_sec" INTEGER,
    "thumbnail_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "step" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "transcript" TEXT NOT NULL DEFAULT '',
    "transcript_source" TEXT,
    "landing_page_id" UUID,
    "video_type" TEXT,
    "extraction_status" TEXT NOT NULL DEFAULT 'NONE',
    "extraction_error" TEXT,
    "extraction" JSONB,
    "extraction_model" TEXT,
    "extracted_at" TIMESTAMP(3),
    "analyzer_promo_id" UUID,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "intel_videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intel_video_frames" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "video_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "at_sec" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "size" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intel_video_frames_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intel_landing_pages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "final_url" TEXT,
    "status" TEXT NOT NULL,
    "http_status" INTEGER,
    "title" TEXT,
    "description" TEXT,
    "headings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "text" TEXT NOT NULL DEFAULT '',
    "links" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intel_landing_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intel_entities" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "competitor_id" UUID,
    "category" TEXT,
    "notes" TEXT,
    "ignored" BOOLEAN NOT NULL DEFAULT false,
    "auto_created" BOOLEAN NOT NULL DEFAULT true,
    "merged_into_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "intel_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intel_entity_refs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "email_id" UUID,
    "video_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intel_entity_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intel_settings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "digest_enabled" BOOLEAN NOT NULL DEFAULT false,
    "slack_webhook_enc" TEXT,
    "digest_emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "auto_landing" BOOLEAN NOT NULL DEFAULT true,
    "last_digest_week" DATE,
    "last_digest_at" TIMESTAMP(3),
    "last_digest_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intel_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "intel_videos_organization_id_brand_id_created_at_idx" ON "intel_videos"("organization_id", "brand_id", "created_at");

-- CreateIndex
CREATE INDEX "intel_videos_status_created_at_idx" ON "intel_videos"("status", "created_at");

-- CreateIndex
CREATE INDEX "intel_video_frames_organization_id_idx" ON "intel_video_frames"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "intel_video_frames_video_id_position_key" ON "intel_video_frames"("video_id", "position");

-- CreateIndex
CREATE INDEX "intel_landing_pages_organization_id_brand_id_idx" ON "intel_landing_pages"("organization_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "intel_landing_pages_brand_id_url_key" ON "intel_landing_pages"("brand_id", "url");

-- CreateIndex
CREATE INDEX "intel_entities_organization_id_brand_id_kind_idx" ON "intel_entities"("organization_id", "brand_id", "kind");

-- CreateIndex
CREATE INDEX "intel_entity_refs_organization_id_idx" ON "intel_entity_refs"("organization_id");

-- CreateIndex
CREATE INDEX "intel_entity_refs_email_id_idx" ON "intel_entity_refs"("email_id");

-- CreateIndex
CREATE INDEX "intel_entity_refs_video_id_idx" ON "intel_entity_refs"("video_id");

-- CreateIndex
CREATE UNIQUE INDEX "intel_entity_refs_entity_id_email_id_key" ON "intel_entity_refs"("entity_id", "email_id");

-- CreateIndex
CREATE UNIQUE INDEX "intel_entity_refs_entity_id_video_id_key" ON "intel_entity_refs"("entity_id", "video_id");

-- CreateIndex
CREATE INDEX "intel_settings_organization_id_idx" ON "intel_settings"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "intel_settings_brand_id_key" ON "intel_settings"("brand_id");

-- AddForeignKey
ALTER TABLE "intel_emails" ADD CONSTRAINT "intel_emails_landing_page_id_fkey" FOREIGN KEY ("landing_page_id") REFERENCES "intel_landing_pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intel_videos" ADD CONSTRAINT "intel_videos_competitor_id_fkey" FOREIGN KEY ("competitor_id") REFERENCES "intel_competitors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intel_videos" ADD CONSTRAINT "intel_videos_landing_page_id_fkey" FOREIGN KEY ("landing_page_id") REFERENCES "intel_landing_pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intel_video_frames" ADD CONSTRAINT "intel_video_frames_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "intel_videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intel_entity_refs" ADD CONSTRAINT "intel_entity_refs_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "intel_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intel_entity_refs" ADD CONSTRAINT "intel_entity_refs_email_id_fkey" FOREIGN KEY ("email_id") REFERENCES "intel_emails"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intel_entity_refs" ADD CONSTRAINT "intel_entity_refs_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "intel_videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Organization and brand foreign keys (added by hand; no relation fields on shared models).
ALTER TABLE "intel_videos" ADD CONSTRAINT "intel_videos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "intel_videos" ADD CONSTRAINT "intel_videos_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "intel_landing_pages" ADD CONSTRAINT "intel_landing_pages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "intel_landing_pages" ADD CONSTRAINT "intel_landing_pages_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "intel_entities" ADD CONSTRAINT "intel_entities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "intel_entities" ADD CONSTRAINT "intel_entities_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "intel_settings" ADD CONSTRAINT "intel_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "intel_settings" ADD CONSTRAINT "intel_settings_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "intel_video_frames" ADD CONSTRAINT "intel_video_frames_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "intel_entity_refs" ADD CONSTRAINT "intel_entity_refs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security: tenant isolation.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['intel_videos', 'intel_video_frames', 'intel_landing_pages', 'intel_entities', 'intel_entity_refs', 'intel_settings']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (public.bypass_rls() OR organization_id = public.current_org_id()) WITH CHECK (public.bypass_rls() OR organization_id = public.current_org_id())', table_name);
  END LOOP;
END $$;
