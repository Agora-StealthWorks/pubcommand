-- AI Agents: platform agents (super admins' agents on the admin console host).
ALTER TABLE "ai_agents" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'organization';
ALTER TABLE "ai_agents" ADD COLUMN "allow_admin_actions" BOOLEAN NOT NULL DEFAULT false;
