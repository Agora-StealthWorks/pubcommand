-- AI Agents: agent members, their tokens, call log, org setting, OAuth codes and clients.

CREATE TABLE "ai_agents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "connection" TEXT NOT NULL DEFAULT 'key',
    "paused_at" TIMESTAMP(3),
    "removed_at" TIMESTAMP(3),
    "last_active_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_agents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_agent_tokens" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "client_id" TEXT,
    "expires_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_agent_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_agent_calls" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "tool" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "message" TEXT,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_agent_calls_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_agent_settings" (
    "organization_id" UUID NOT NULL,
    "allow_publishing" BOOLEAN NOT NULL DEFAULT true,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_agent_settings_pkey" PRIMARY KEY ("organization_id")
);

CREATE TABLE "ai_agent_oauth_codes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "client_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "code_challenge" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_agent_oauth_codes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_oauth_clients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "redirect_uris" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),

    CONSTRAINT "agent_oauth_clients_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_agents_user_id_key" ON "ai_agents"("user_id");

CREATE INDEX "ai_agents_organization_id_idx" ON "ai_agents"("organization_id");

CREATE INDEX "ai_agents_organization_id_owner_user_id_idx" ON "ai_agents"("organization_id", "owner_user_id");

CREATE UNIQUE INDEX "ai_agent_tokens_token_hash_key" ON "ai_agent_tokens"("token_hash");

CREATE INDEX "ai_agent_tokens_organization_id_idx" ON "ai_agent_tokens"("organization_id");

CREATE INDEX "ai_agent_tokens_agent_id_idx" ON "ai_agent_tokens"("agent_id");

CREATE INDEX "ai_agent_calls_agent_id_created_at_idx" ON "ai_agent_calls"("agent_id", "created_at");

CREATE INDEX "ai_agent_calls_organization_id_created_at_idx" ON "ai_agent_calls"("organization_id", "created_at");

CREATE UNIQUE INDEX "ai_agent_oauth_codes_code_hash_key" ON "ai_agent_oauth_codes"("code_hash");

CREATE INDEX "ai_agent_oauth_codes_organization_id_idx" ON "ai_agent_oauth_codes"("organization_id");

ALTER TABLE "ai_agent_tokens" ADD CONSTRAINT "ai_agent_tokens_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_agent_calls" ADD CONSTRAINT "ai_agent_calls_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written foreign keys (Prisma relations to core tables are not declared in the schema).
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_agent_tokens" ADD CONSTRAINT "ai_agent_tokens_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_agent_calls" ADD CONSTRAINT "ai_agent_calls_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_agent_settings" ADD CONSTRAINT "ai_agent_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_agent_oauth_codes" ADD CONSTRAINT "ai_agent_oauth_codes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_agent_oauth_codes" ADD CONSTRAINT "ai_agent_oauth_codes_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security on every organization table.
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['ai_agents', 'ai_agent_tokens', 'ai_agent_calls', 'ai_agent_settings', 'ai_agent_oauth_codes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (public.bypass_rls() OR organization_id = public.current_org_id()) WITH CHECK (public.bypass_rls() OR organization_id = public.current_org_id())', table_name);
  END LOOP;
END $$;
