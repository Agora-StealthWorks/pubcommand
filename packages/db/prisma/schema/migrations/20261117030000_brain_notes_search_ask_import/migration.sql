-- CreateEnum
CREATE TYPE "KnowledgeRunStatus" AS ENUM ('DRY_RUN', 'QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- AlterTable
ALTER TABLE "knowledge_pages" ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "search_vector" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english'::regconfig, coalesce("title", '')), 'A') ||
  setweight(to_tsvector('english'::regconfig, left(coalesce("body", ''), 500000)), 'B')
) STORED,
ADD COLUMN     "shared_at" TIMESTAMP(3),
ADD COLUMN     "shared_by_id" UUID,
ADD COLUMN     "updated_by_id" UUID;

-- CreateTable
CREATE TABLE "knowledge_questions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID,
    "question" TEXT NOT NULL,
    "status" "KnowledgeRunStatus" NOT NULL DEFAULT 'QUEUED',
    "answer" JSONB,
    "error" TEXT,
    "model" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_imports" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID,
    "filename" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "status" "KnowledgeRunStatus" NOT NULL DEFAULT 'DRY_RUN',
    "report" JSONB,
    "error" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_questions_organization_id_brand_id_created_at_idx" ON "knowledge_questions"("organization_id", "brand_id", "created_at");

-- CreateIndex
CREATE INDEX "knowledge_imports_organization_id_created_at_idx" ON "knowledge_imports"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "knowledge_pages_organization_id_visibility_idx" ON "knowledge_pages"("organization_id", "visibility");

-- CreateIndex
CREATE INDEX "knowledge_pages_search_vector_idx" ON "knowledge_pages" USING GIN ("search_vector");

-- AddForeignKey (by hand: no relation fields on Organization/Brand)
ALTER TABLE "knowledge_questions" ADD CONSTRAINT "knowledge_questions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_questions" ADD CONSTRAINT "knowledge_questions_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_imports" ADD CONSTRAINT "knowledge_imports_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_imports" ADD CONSTRAINT "knowledge_imports_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Give the new knowledge.share permission to the existing owner/admin roles that can already write to the Brain.
INSERT INTO "role_permissions" ("id", "organization_id", "role_id", "permission", "effect")
SELECT gen_random_uuid(), rp."organization_id", rp."role_id", 'knowledge.share', 'ALLOW'
FROM "role_permissions" rp
JOIN "roles" r ON r."id" = rp."role_id"
WHERE rp."permission" = 'knowledge.write' AND rp."effect" = 'ALLOW' AND r."slug" IN ('owner', 'admin')
ON CONFLICT ("role_id", "permission") DO NOTHING;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['knowledge_questions', 'knowledge_imports']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (public.bypass_rls() OR organization_id = public.current_org_id()) WITH CHECK (public.bypass_rls() OR organization_id = public.current_org_id())', table_name);
  END LOOP;
END $$;
