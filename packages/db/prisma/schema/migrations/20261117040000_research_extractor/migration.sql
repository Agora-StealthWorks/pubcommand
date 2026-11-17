-- Research Extractor (module `research`). Additive only.

-- CreateTable
CREATE TABLE "research_projects" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "share_with_brain" BOOLEAN NOT NULL DEFAULT false,
    "public_token" TEXT,
    "public_enabled" BOOLEAN NOT NULL DEFAULT false,
    "group_status" TEXT NOT NULL DEFAULT 'NONE',
    "group_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "research_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_shares" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "permission" TEXT NOT NULL DEFAULT 'view',
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_sources" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "input_type" TEXT NOT NULL DEFAULT 'text',
    "title" TEXT NOT NULL,
    "source_ref" TEXT,
    "raw_text" TEXT NOT NULL DEFAULT '',
    "summary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "card_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_files" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_cards" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "source_id" UUID,
    "topic" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "details" TEXT NOT NULL DEFAULT '',
    "card_type" TEXT NOT NULL DEFAULT 'fact',
    "key_points" JSONB NOT NULL DEFAULT '[]',
    "source_label" TEXT NOT NULL DEFAULT '',
    "source_url" TEXT,
    "group_name" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "position" INTEGER NOT NULL DEFAULT 0,
    "origin" TEXT NOT NULL DEFAULT 'ai',
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_sections" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_bullets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_bullets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_bullet_cards" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "bullet_id" UUID NOT NULL,
    "card_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "research_bullet_cards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "research_projects_public_token_key" ON "research_projects"("public_token");

-- CreateIndex
CREATE INDEX "research_projects_organization_id_brand_id_deleted_at_updat_idx" ON "research_projects"("organization_id", "brand_id", "deleted_at", "updated_at");

-- CreateIndex
CREATE INDEX "research_projects_owner_id_idx" ON "research_projects"("owner_id");

-- CreateIndex
CREATE INDEX "research_shares_organization_id_email_idx" ON "research_shares"("organization_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "research_shares_project_id_email_key" ON "research_shares"("project_id", "email");

-- CreateIndex
CREATE INDEX "research_sources_organization_id_project_id_created_at_idx" ON "research_sources"("organization_id", "project_id", "created_at");

-- CreateIndex
CREATE INDEX "research_files_organization_id_source_id_idx" ON "research_files"("organization_id", "source_id");

-- CreateIndex
CREATE INDEX "research_cards_organization_id_project_id_position_idx" ON "research_cards"("organization_id", "project_id", "position");

-- CreateIndex
CREATE INDEX "research_cards_source_id_idx" ON "research_cards"("source_id");

-- CreateIndex
CREATE INDEX "research_sections_organization_id_project_id_position_idx" ON "research_sections"("organization_id", "project_id", "position");

-- CreateIndex
CREATE INDEX "research_bullets_organization_id_section_id_position_idx" ON "research_bullets"("organization_id", "section_id", "position");

-- CreateIndex
CREATE INDEX "research_bullet_cards_organization_id_project_id_idx" ON "research_bullet_cards"("organization_id", "project_id");

-- CreateIndex
CREATE INDEX "research_bullet_cards_card_id_idx" ON "research_bullet_cards"("card_id");

-- CreateIndex
CREATE UNIQUE INDEX "research_bullet_cards_bullet_id_card_id_key" ON "research_bullet_cards"("bullet_id", "card_id");

-- AddForeignKey
ALTER TABLE "research_shares" ADD CONSTRAINT "research_shares_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "research_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_sources" ADD CONSTRAINT "research_sources_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "research_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_files" ADD CONSTRAINT "research_files_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "research_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_cards" ADD CONSTRAINT "research_cards_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "research_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_cards" ADD CONSTRAINT "research_cards_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "research_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_sections" ADD CONSTRAINT "research_sections_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "research_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_bullets" ADD CONSTRAINT "research_bullets_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "research_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_bullet_cards" ADD CONSTRAINT "research_bullet_cards_bullet_id_fkey" FOREIGN KEY ("bullet_id") REFERENCES "research_bullets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_bullet_cards" ADD CONSTRAINT "research_bullet_cards_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "research_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant foreign keys (no Prisma relations on shared models).
ALTER TABLE "research_projects" ADD CONSTRAINT "research_projects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_shares" ADD CONSTRAINT "research_shares_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_sources" ADD CONSTRAINT "research_sources_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_files" ADD CONSTRAINT "research_files_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_cards" ADD CONSTRAINT "research_cards_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_sections" ADD CONSTRAINT "research_sections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_bullets" ADD CONSTRAINT "research_bullets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_bullet_cards" ADD CONSTRAINT "research_bullet_cards_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_projects" ADD CONSTRAINT "research_projects_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_projects" ADD CONSTRAINT "research_projects_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Entitle the new module on the existing plans that carry the full catalog or Pro.
INSERT INTO "plan_modules" ("plan_id", "module_id")
SELECT p."id", 'research' FROM "plans" p WHERE p."key" IN ('internal', 'enterprise', 'pro')
ON CONFLICT DO NOTHING;

-- Give research.read and research.write to the existing owner/admin roles.
INSERT INTO "role_permissions" ("id", "organization_id", "role_id", "permission", "effect")
SELECT gen_random_uuid(), r."organization_id", r."id", perm.permission, 'ALLOW'
FROM "roles" r
CROSS JOIN (VALUES ('research.read'), ('research.write')) AS perm(permission)
WHERE r."slug" IN ('owner', 'admin')
ON CONFLICT ("role_id", "permission") DO NOTHING;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['research_projects', 'research_shares', 'research_sources', 'research_files', 'research_cards', 'research_sections', 'research_bullets', 'research_bullet_cards']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (public.bypass_rls() OR organization_id = public.current_org_id()) WITH CHECK (public.bypass_rls() OR organization_id = public.current_org_id())', table_name);
  END LOOP;
END $$;
