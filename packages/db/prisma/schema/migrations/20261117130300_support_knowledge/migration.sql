-- Support Knowledge (module `support`). Additive only.

-- CreateTable
CREATE TABLE "support_records" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'member',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "url" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "publication_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" TEXT NOT NULL DEFAULT 'manual',
    "source_ref" TEXT,
    "source_hash" TEXT,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "gate_hits" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "gate_overrides" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "price_confirmed_at" TIMESTAMP(3),
    "price_confirmed_by_id" UUID,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_revisions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "record_id" UUID NOT NULL,
    "snapshot" JSONB NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "edited_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_chunks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "record_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "ord" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "search_vector" tsvector GENERATED ALWAYS AS (setweight(to_tsvector('english'::regconfig, COALESCE(title, ''::text)), 'A'::"char") || setweight(to_tsvector('english'::regconfig, COALESCE(content, ''::text)), 'B'::"char")) STORED,

    CONSTRAINT "support_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_agent_profiles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "persona_name" TEXT NOT NULL DEFAULT 'Merlin',
    "surface" TEXT NOT NULL DEFAULT 'chat',
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "audiences" TEXT[] DEFAULT ARRAY['public']::TEXT[],
    "instructions" TEXT NOT NULL DEFAULT '',
    "escalation" TEXT NOT NULL DEFAULT '',
    "first_message" TEXT NOT NULL DEFAULT '',
    "key_hash" TEXT,
    "key_prefix" TEXT,
    "key_created_at" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "rate_limit" INTEGER NOT NULL DEFAULT 120,
    "last_used_at" TIMESTAMP(3),
    "webhook_secret_enc" TEXT,
    "platform" TEXT NOT NULL DEFAULT 'none',
    "remote_agent_id" TEXT,
    "remote_secret_id" TEXT,
    "auto_sync" BOOLEAN NOT NULL DEFAULT false,
    "last_pushed_at" TIMESTAMP(3),
    "last_pushed_prompt" TEXT,
    "last_sync_result" JSONB,
    "sync_status" TEXT NOT NULL DEFAULT 'idle',
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "support_agent_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_connections" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'elevenlabs',
    "api_key_enc" TEXT NOT NULL,
    "key_hint" TEXT NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_platform_docs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'doc',
    "doc_key" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "remote_id" TEXT,
    "content_hash" TEXT NOT NULL DEFAULT '',
    "remote_hash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "last_pushed_at" TIMESTAMP(3),
    "last_pulled_at" TIMESTAMP(3),

    CONSTRAINT "support_platform_docs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_proposals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "source_ref" TEXT,
    "profile_id" UUID,
    "target_id" UUID,
    "gate_hits" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'pending',
    "record_id" UUID,
    "created_by_id" UUID,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_gaps" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "profile_id" UUID,
    "question" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "conversation_id" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'open',
    "record_id" UUID,
    "created_by_id" UUID,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "support_gaps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_api_calls" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "tool" TEXT NOT NULL,
    "query" TEXT NOT NULL DEFAULT '',
    "hits" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_api_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_settings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "persona_name" TEXT NOT NULL DEFAULT 'Merlin',
    "escalation" TEXT NOT NULL DEFAULT '',
    "ingest_key_hash" TEXT,
    "ingest_key_prefix" TEXT,
    "site_sheet_url" TEXT,
    "site_sheet_sync" BOOLEAN NOT NULL DEFAULT false,
    "last_sheet_sync_at" TIMESTAMP(3),
    "last_sheet_result" JSONB,
    "pubsetup_sync" BOOLEAN NOT NULL DEFAULT true,
    "last_pubsetup_at" TIMESTAMP(3),
    "last_pubsetup_result" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_records_organization_id_brand_id_status_category_idx" ON "support_records"("organization_id", "brand_id", "status", "category");

-- CreateIndex
CREATE UNIQUE INDEX "support_records_brand_id_source_ref_key" ON "support_records"("brand_id", "source_ref");

-- CreateIndex
CREATE INDEX "support_revisions_record_id_created_at_idx" ON "support_revisions"("record_id", "created_at");

-- CreateIndex
CREATE INDEX "support_chunks_organization_id_brand_id_status_category_aud_idx" ON "support_chunks"("organization_id", "brand_id", "status", "category", "audience");

-- CreateIndex
CREATE INDEX "support_chunks_record_id_idx" ON "support_chunks"("record_id");

-- CreateIndex
CREATE INDEX "support_chunks_search_vector_idx" ON "support_chunks" USING GIN ("search_vector");

-- CreateIndex
CREATE UNIQUE INDEX "support_agent_profiles_key_hash_key" ON "support_agent_profiles"("key_hash");

-- CreateIndex
CREATE INDEX "support_agent_profiles_organization_id_brand_id_deleted_at_idx" ON "support_agent_profiles"("organization_id", "brand_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "support_connections_brand_id_platform_key" ON "support_connections"("brand_id", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "support_platform_docs_profile_id_kind_doc_key_key" ON "support_platform_docs"("profile_id", "kind", "doc_key");

-- CreateIndex
CREATE INDEX "support_proposals_organization_id_brand_id_status_idx" ON "support_proposals"("organization_id", "brand_id", "status");

-- CreateIndex
CREATE INDEX "support_gaps_organization_id_brand_id_status_idx" ON "support_gaps"("organization_id", "brand_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "support_gaps_brand_id_normalized_key" ON "support_gaps"("brand_id", "normalized");

-- CreateIndex
CREATE INDEX "support_api_calls_profile_id_created_at_idx" ON "support_api_calls"("profile_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "support_settings_ingest_key_hash_key" ON "support_settings"("ingest_key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "support_settings_brand_id_key" ON "support_settings"("brand_id");

-- AddForeignKey
ALTER TABLE "support_revisions" ADD CONSTRAINT "support_revisions_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "support_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_chunks" ADD CONSTRAINT "support_chunks_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "support_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_platform_docs" ADD CONSTRAINT "support_platform_docs_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "support_agent_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-added foreign keys to shared tables (no relation fields on Organization/Brand).
ALTER TABLE "support_records" ADD CONSTRAINT "support_records_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_revisions" ADD CONSTRAINT "support_revisions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_chunks" ADD CONSTRAINT "support_chunks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_agent_profiles" ADD CONSTRAINT "support_agent_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_connections" ADD CONSTRAINT "support_connections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_platform_docs" ADD CONSTRAINT "support_platform_docs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_proposals" ADD CONSTRAINT "support_proposals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_gaps" ADD CONSTRAINT "support_gaps_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_api_calls" ADD CONSTRAINT "support_api_calls_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_settings" ADD CONSTRAINT "support_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_records" ADD CONSTRAINT "support_records_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_chunks" ADD CONSTRAINT "support_chunks_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_agent_profiles" ADD CONSTRAINT "support_agent_profiles_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_connections" ADD CONSTRAINT "support_connections_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_proposals" ADD CONSTRAINT "support_proposals_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_gaps" ADD CONSTRAINT "support_gaps_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_settings" ADD CONSTRAINT "support_settings_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_api_calls" ADD CONSTRAINT "support_api_calls_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "support_agent_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security: tenant isolation on every Support Knowledge table.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['support_records', 'support_revisions', 'support_chunks', 'support_agent_profiles', 'support_connections', 'support_platform_docs', 'support_proposals', 'support_gaps', 'support_api_calls', 'support_settings']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (public.bypass_rls() OR organization_id = public.current_org_id()) WITH CHECK (public.bypass_rls() OR organization_id = public.current_org_id())', table_name);
  END LOOP;
END $$;

-- Entitlement: Support Knowledge in the Pro, Enterprise and Internal plans.
INSERT INTO "plan_modules" ("plan_id", "module_id")
SELECT p."id", 'support' FROM "plans" p WHERE p."key" IN ('internal', 'enterprise', 'pro')
ON CONFLICT DO NOTHING;

-- Owners and admins get every Support Knowledge permission (new organizations get them through the registry).
INSERT INTO "role_permissions" ("id", "organization_id", "role_id", "permission", "effect")
SELECT gen_random_uuid(), r."organization_id", r."id", perm.key, 'ALLOW'
FROM "roles" r
CROSS JOIN (VALUES ('support.read'), ('support.write'), ('support.publish')) AS perm(key)
WHERE r."slug" IN ('owner', 'admin')
ON CONFLICT ("role_id", "permission") DO NOTHING;
