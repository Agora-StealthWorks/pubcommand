-- Row-level security, slug guards, append-only platform audit, optional pgvector.
-- Keep the reserved slug list aligned with RESERVED_SLUGS in packages/core.

CREATE OR REPLACE FUNCTION public.current_org_id() RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN coalesce(current_setting('app.current_org_id', true), '') = '' THEN NULL
    ELSE current_setting('app.current_org_id', true)::uuid
  END
$$;

CREATE OR REPLACE FUNCTION public.bypass_rls() RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(current_setting('app.bypass_rls', true), '') = 'on'
$$;

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
  WHERE o.slug = p_slug;
  IF FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT o.id, o.name, o.slug, o.suspended_at, true
  FROM organization_slug_history h
  JOIN organizations o ON o.id = h.organization_id
  WHERE h.slug = p_slug
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_organization_slug()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.slug !~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$' THEN
    RAISE EXCEPTION 'invalid organization slug';
  END IF;
  IF NEW.slug = ANY (ARRAY['www','app','admin','api','platform','mail','status','docs','help','billing','auth','static','cdn']) THEN
    RAISE EXCEPTION 'reserved organization slug';
  END IF;
  IF EXISTS (SELECT 1 FROM organization_slug_history WHERE slug = NEW.slug) THEN
    RAISE EXCEPTION 'slug is retained for redirect';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_slug_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM organizations WHERE slug = NEW.slug) THEN
    RAISE EXCEPTION 'slug is still current';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organizations_slug ON organizations;
CREATE TRIGGER organizations_slug
  BEFORE INSERT OR UPDATE OF slug ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_organization_slug();

DROP TRIGGER IF EXISTS organization_slug_history_guard ON organization_slug_history;
CREATE TRIGGER organization_slug_history_guard
  BEFORE INSERT OR UPDATE OF slug ON organization_slug_history
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_slug_history();

CREATE OR REPLACE FUNCTION public.reject_platform_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'platform_audit_logs is append-only';
END;
$$;

DROP TRIGGER IF EXISTS platform_audit_no_update ON platform_audit_logs;
CREATE TRIGGER platform_audit_no_update
  BEFORE UPDATE ON platform_audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_platform_audit_mutation();

DROP TRIGGER IF EXISTS platform_audit_no_delete ON platform_audit_logs;
CREATE TRIGGER platform_audit_no_delete
  BEFORE DELETE ON platform_audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_platform_audit_mutation();

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'brands',
    'workspaces',
    'memberships',
    'roles',
    'role_permissions',
    'exclusions',
    'audit_logs',
    'organization_modules',
    'organization_slug_history',
    'org_settings'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (public.bypass_rls() OR organization_id = public.current_org_id()) WITH CHECK (public.bypass_rls() OR organization_id = public.current_org_id())',
      table_name
    );
  END LOOP;
END $$;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON organizations;
CREATE POLICY tenant_isolation ON organizations
  USING (public.bypass_rls() OR id = public.current_org_id())
  WITH CHECK (public.bypass_rls() OR id = public.current_org_id());

GRANT EXECUTE ON FUNCTION public.current_org_id() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.bypass_rls() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_org_slug(text) TO PUBLIC;

-- Official Railway Postgres may not include pgvector. Phase 1 has no vector columns.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pgvector extension is unavailable (%). Phase 1 continues without it. Switch the Postgres service to a pgvector image such as pgvector/pgvector:pg16 before a later phase adds vector columns.', SQLERRM;
END $$;
