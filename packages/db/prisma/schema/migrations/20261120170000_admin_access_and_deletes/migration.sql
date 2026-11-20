-- Platform admin: per-organization app access, per-member app access, built-in
-- User/Editor roles, soft-deleted organizations and deleted (anonymized) accounts.
-- Additive only: new columns, new tables, new policies. resolve_org_slug keeps
-- its signature and now skips deleted organizations.

ALTER TABLE "organizations" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN "deleted_by_id" UUID;
CREATE INDEX "organizations_deleted_at_idx" ON "organizations"("deleted_at");

ALTER TABLE "users" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "deleted_by_id" UUID;

CREATE TYPE "AppAccessOverride" AS ENUM ('ALLOWED', 'BLOCKED');
CREATE TYPE "MemberAppLevel" AS ENUM ('NONE', 'VIEW', 'EDIT');

CREATE TABLE "organization_app_access" (
    "organization_id" UUID NOT NULL,
    "module_id" TEXT NOT NULL,
    "access" "AppAccessOverride" NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organization_app_access_pkey" PRIMARY KEY ("organization_id", "module_id")
);
ALTER TABLE "organization_app_access" ADD CONSTRAINT "organization_app_access_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "member_app_access" (
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "module_id" TEXT NOT NULL,
    "level" "MemberAppLevel" NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "member_app_access_pkey" PRIMARY KEY ("organization_id", "user_id", "module_id")
);
CREATE INDEX "member_app_access_organization_id_idx" ON "member_app_access"("organization_id");
ALTER TABLE "member_app_access" ADD CONSTRAINT "member_app_access_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "member_app_access" ADD CONSTRAINT "member_app_access_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Staff overrides: an organization may read its own rows; only platform code (bypass_rls) writes.
ALTER TABLE "organization_app_access" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organization_app_access" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_read ON "organization_app_access";
CREATE POLICY org_read ON "organization_app_access" FOR SELECT
  USING (public.bypass_rls() OR organization_id = public.current_org_id());
DROP POLICY IF EXISTS platform_write ON "organization_app_access";
CREATE POLICY platform_write ON "organization_app_access" FOR ALL
  USING (public.bypass_rls()) WITH CHECK (public.bypass_rls());

-- Member app access is ordinary tenant data (written by org admins through the tenant client).
ALTER TABLE "member_app_access" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "member_app_access" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "member_app_access";
CREATE POLICY tenant_isolation ON "member_app_access"
  USING (public.bypass_rls() OR organization_id = public.current_org_id())
  WITH CHECK (public.bypass_rls() OR organization_id = public.current_org_id());

-- A deleted organization no longer resolves: its subdomain and every page under it 404.
CREATE OR REPLACE FUNCTION public.resolve_org_slug(p_slug text)
RETURNS TABLE(id uuid, name text, slug text, suspended_at timestamp(3), redirected boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT o.id, o.name, o.slug, o.suspended_at, false
  FROM organizations o
  WHERE o.slug = p_slug AND o.deleted_at IS NULL;
  IF FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT o.id, o.name, o.slug, o.suspended_at, true
  FROM organization_slug_history h
  JOIN organizations o ON o.id = h.organization_id
  WHERE h.slug = p_slug AND o.deleted_at IS NULL
  LIMIT 1;
END;
$$;

-- Built-in roles for organizations that already exist: User (read-only) and Editor
-- (User + websites.write). Created only where the slug is free; existing roles,
-- grants and members' roles are never changed. Permissions here mirror
-- builtInRolePermissions() in packages/core at the time of this migration;
-- `pnpm --filter @pubcommand/db ensure-roles` (run on every boot) creates the
-- same roles for organizations made later, from the live manifests.
DO $$
DECLARE
  org record;
  role_id uuid;
  read_perms text[] := ARRAY[
    'billing.read','editorial.read','example.view','forms.read','funnels.read','intel.read','knowledge.read',
    'miniblog.read','performance.read','promo.read','research.read','support.read','testimonials.read',
    'websites.read','wiki.read'
  ];
BEGIN
  FOR org IN SELECT id FROM organizations LOOP
    IF NOT EXISTS (SELECT 1 FROM roles WHERE organization_id = org.id AND slug = 'user') THEN
      role_id := gen_random_uuid();
      INSERT INTO roles (id, organization_id, name, slug, description, is_system, created_at, updated_at)
      VALUES (role_id, org.id, 'User', 'user', 'Read-only: can look at every app the organization has, but not change anything.', true, now(), now());
      INSERT INTO role_permissions (id, organization_id, role_id, permission, effect)
      SELECT gen_random_uuid(), org.id, role_id, p, 'ALLOW' FROM unnest(read_perms) AS p;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM roles WHERE organization_id = org.id AND slug = 'editor') THEN
      role_id := gen_random_uuid();
      INSERT INTO roles (id, organization_id, name, slug, description, is_system, created_at, updated_at)
      VALUES (role_id, org.id, 'Editor', 'editor', 'Everything a User has, plus writing and editing website posts, pages, media, categories and tags.', true, now(), now());
      INSERT INTO role_permissions (id, organization_id, role_id, permission, effect)
      SELECT gen_random_uuid(), org.id, role_id, p, 'ALLOW' FROM unnest(read_perms || ARRAY['websites.write']) AS p;
    END IF;
  END LOOP;
END $$;
