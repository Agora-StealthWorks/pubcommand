-- Brain: the main Brain becomes platform level (PubCommand staff only).
-- Additive only. New platform tables have no organization_id (the tenant client
-- cannot reach them) and row-level security that only allows app.bypass_rls.
-- Old organization-level notes (knowledge_pages.brand_id IS NULL) are copied into
-- main_brain_notes, verified, then marked (moved_to_main_at, visibility PRIVATE,
-- source_ref prefixed "legacy:"). The originals stay in place; their original
-- visibility and sourceRef are kept on the copy (origin_meta, origin_source_ref).
-- Nothing is deleted.

-- CreateEnum
CREATE TYPE "MainBrainOrigin" AS ENUM ('LEARNED', 'IMPORTED', 'AUTHORED', 'MIGRATED');

-- CreateEnum
CREATE TYPE "MainBrainPushScope" AS ENUM ('NONE', 'ALL', 'SELECTED');

-- AlterTable
ALTER TABLE "knowledge_pages" ADD COLUMN     "moved_to_main_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "knowledge_questions" ADD COLUMN     "hidden_at" TIMESTAMP(3),
ADD COLUMN     "saved_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "knowledge_attachments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "note_id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "main_brain_notes" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "folder" TEXT,
    "origin" "MainBrainOrigin" NOT NULL,
    "source" TEXT NOT NULL,
    "origin_organization_id" UUID,
    "origin_brand_id" UUID,
    "origin_source_ref" TEXT,
    "origin_note_id" UUID,
    "origin_meta" JSONB,
    "learned_at" TIMESTAMP(3),
    "edited_at" TIMESTAMP(3),
    "push_scope" "MainBrainPushScope" NOT NULL DEFAULT 'NONE',
    "pushed_at" TIMESTAMP(3),
    "pushed_by_id" UUID,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "search_vector" tsvector GENERATED ALWAYS AS (
      setweight(to_tsvector('english'::regconfig, coalesce("title", '')), 'A') ||
      setweight(to_tsvector('english'::regconfig, left(coalesce("body", ''), 500000)), 'B')
    ) STORED,

    CONSTRAINT "main_brain_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "main_brain_push_targets" (
    "note_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "target_organization_id" UUID NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "main_brain_push_targets_pkey" PRIMARY KEY ("note_id","brand_id")
);

-- CreateTable
CREATE TABLE "main_brain_attachments" (
    "id" UUID NOT NULL,
    "note_id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "main_brain_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "main_brain_questions" (
    "id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "status" "KnowledgeRunStatus" NOT NULL DEFAULT 'QUEUED',
    "answer" JSONB,
    "error" TEXT,
    "model" TEXT,
    "asked_by_id" UUID,
    "saved_at" TIMESTAMP(3),
    "hidden_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "main_brain_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "main_brain_imports" (
    "id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "status" "KnowledgeRunStatus" NOT NULL DEFAULT 'DRY_RUN',
    "report" JSONB,
    "error" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "main_brain_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_attachments_organization_id_idx" ON "knowledge_attachments"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_attachments_note_id_filename_key" ON "knowledge_attachments"("note_id", "filename");

-- CreateIndex
CREATE UNIQUE INDEX "main_brain_notes_key_key" ON "main_brain_notes"("key");

-- CreateIndex
CREATE UNIQUE INDEX "main_brain_notes_slug_key" ON "main_brain_notes"("slug");

-- CreateIndex
CREATE INDEX "main_brain_notes_origin_organization_id_origin_brand_id_idx" ON "main_brain_notes"("origin_organization_id", "origin_brand_id");

-- CreateIndex
CREATE INDEX "main_brain_notes_origin_idx" ON "main_brain_notes"("origin");

-- CreateIndex
CREATE INDEX "main_brain_notes_push_scope_idx" ON "main_brain_notes"("push_scope");

-- CreateIndex
CREATE INDEX "main_brain_notes_search_vector_idx" ON "main_brain_notes" USING GIN ("search_vector");

-- CreateIndex
CREATE INDEX "main_brain_push_targets_brand_id_idx" ON "main_brain_push_targets"("brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "main_brain_attachments_note_id_filename_key" ON "main_brain_attachments"("note_id", "filename");

-- CreateIndex
CREATE INDEX "main_brain_questions_asked_by_id_created_at_idx" ON "main_brain_questions"("asked_by_id", "created_at");

-- CreateIndex
CREATE INDEX "main_brain_imports_created_at_idx" ON "main_brain_imports"("created_at");

-- CreateIndex
CREATE INDEX "knowledge_questions_organization_id_created_by_id_created_a_idx" ON "knowledge_questions"("organization_id", "created_by_id", "created_at");

-- AddForeignKey
ALTER TABLE "knowledge_attachments" ADD CONSTRAINT "knowledge_attachments_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "knowledge_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "main_brain_push_targets" ADD CONSTRAINT "main_brain_push_targets_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "main_brain_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "main_brain_attachments" ADD CONSTRAINT "main_brain_attachments_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "main_brain_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written foreign keys (no relation fields on Organization/Brand).
ALTER TABLE "knowledge_attachments" ADD CONSTRAINT "knowledge_attachments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "main_brain_push_targets" ADD CONSTRAINT "main_brain_push_targets_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "main_brain_push_targets" ADD CONSTRAINT "main_brain_push_targets_target_organization_id_fkey" FOREIGN KEY ("target_organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Provenance survives an organization or brand being deleted (the knowledge stays; the link is cleared).
ALTER TABLE "main_brain_notes" ADD CONSTRAINT "main_brain_notes_origin_organization_id_fkey" FOREIGN KEY ("origin_organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "main_brain_notes" ADD CONSTRAINT "main_brain_notes_origin_brand_id_fkey" FOREIGN KEY ("origin_brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Data: copy legacy organization-level notes into the main Brain.
-- Keys match what the new code writes, so later writes update the copy instead of
-- duplicating it: "vault:<path>" (console vault import; when two organizations
-- imported the same path the newest keeps it and the others become
-- learned:<org>:vault:<path>), "learned:<org>:<sourceRef>" (an app's teachBrain),
-- "migrated:<id>" (no sourceRef).
WITH legacy AS (
  SELECT p.*,
         row_number() OVER (PARTITION BY coalesce(p.source_ref, p.id::text) ORDER BY p.updated_at DESC, p.id) AS rn
  FROM "knowledge_pages" p
  WHERE p."brand_id" IS NULL AND p."moved_to_main_at" IS NULL
)
INSERT INTO "main_brain_notes" (
  "id", "key", "title", "slug", "body", "folder", "origin", "source",
  "origin_organization_id", "origin_brand_id", "origin_source_ref", "origin_note_id", "origin_meta",
  "created_by_id", "updated_by_id", "created_at", "updated_at", "deleted_at"
)
SELECT gen_random_uuid(),
       CASE WHEN l.source_ref LIKE 'vault:%' AND l.rn = 1 THEN l.source_ref
            WHEN l.source_ref IS NOT NULL THEN 'learned:' || l.organization_id::text || ':' || l.source_ref
            ELSE 'migrated:' || l.id::text END,
       l.title,
       left(l.slug, 60) || '-' || left(l.id::text, 8),
       l.body,
       l.folder,
       'MIGRATED',
       l.source,
       l.organization_id,
       NULL,
       l.source_ref,
       l.id,
       jsonb_build_object('visibility', l.visibility::text, 'sharedAt', l.shared_at, 'slug', l.slug),
       l.created_by_id,
       l.updated_by_id,
       l.created_at,
       l.updated_at,
       l.deleted_at
FROM legacy l
ON CONFLICT DO NOTHING;

-- Verify, then mark: only rows whose copy exists with the same title and body.
UPDATE "knowledge_pages" p
SET "moved_to_main_at" = CURRENT_TIMESTAMP,
    "visibility" = 'PRIVATE',
    -- Frees the sourceRef so a brand can import or be taught the same key later.
    "source_ref" = CASE WHEN p."source_ref" IS NULL THEN NULL ELSE 'legacy:' || p."source_ref" END
FROM "main_brain_notes" m
WHERE p."brand_id" IS NULL
  AND p."moved_to_main_at" IS NULL
  AND m."origin" = 'MIGRATED'
  AND m."origin_note_id" = p."id"
  AND m."title" = p."title"
  AND m."body" = p."body";

-- ---------------------------------------------------------------------------
-- Row-level security.
-- knowledge_attachments is a tenant table like every other.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['knowledge_attachments']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (public.bypass_rls() OR organization_id = public.current_org_id()) WITH CHECK (public.bypass_rls() OR organization_id = public.current_org_id())', table_name);
  END LOOP;
END $$;

-- The main Brain tables belong to no organization: only platform code that sets
-- app.bypass_rls may read or write them. An organization context sees nothing.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['main_brain_notes', 'main_brain_push_targets', 'main_brain_attachments', 'main_brain_questions', 'main_brain_imports']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS platform_only ON %I', table_name);
    EXECUTE format('CREATE POLICY platform_only ON %I USING (public.bypass_rls()) WITH CHECK (public.bypass_rls())', table_name);
  END LOOP;
END $$;
