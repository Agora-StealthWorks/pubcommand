-- Calendar promos become the Calendar's own records, independent of Promo Analyzer.
-- Additive only: calendar_promo_tracks and the old promo_id columns stay in place, unused.


-- AlterTable
ALTER TABLE "calendar_cub_rounds" ADD COLUMN     "calendar_promo_id" UUID;

-- AlterTable
ALTER TABLE "calendar_events" ADD COLUMN     "calendar_promo_id" UUID;

-- AlterTable
ALTER TABLE "calendar_issues" ADD COLUMN     "calendar_promo_id" UUID;

-- CreateTable
CREATE TABLE "calendar_promos" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "promo_type" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'Idea',
    "writers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "format" TEXT,
    "product" TEXT,
    "gurus" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "targeted_date" DATE,
    "launch_date" DATE,
    "launch_estimated" BOOLEAN NOT NULL DEFAULT false,
    "copy_platform_url" TEXT,
    "hotlist_page_url" TEXT,
    "promo_file_url" TEXT,
    "cub_draft_url" TEXT,
    "copy_platform" JSONB,
    "launch_event_id" UUID,
    "launch_event_created" BOOLEAN NOT NULL DEFAULT false,
    "airtable_id" TEXT,
    "legacy_promo_id" UUID,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "calendar_promos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_promo_activity" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "promo_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "field" TEXT,
    "from_value" TEXT,
    "to_value" TEXT,
    "note" TEXT,
    "actor_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_promo_activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "calendar_promos_legacy_promo_id_key" ON "calendar_promos"("legacy_promo_id");

-- CreateIndex
CREATE INDEX "calendar_promos_organization_id_brand_id_stage_idx" ON "calendar_promos"("organization_id", "brand_id", "stage");

-- CreateIndex
CREATE INDEX "calendar_promos_brand_id_launch_date_idx" ON "calendar_promos"("brand_id", "launch_date");

-- CreateIndex
CREATE INDEX "calendar_promo_activity_organization_id_promo_id_created_at_idx" ON "calendar_promo_activity"("organization_id", "promo_id", "created_at");

-- CreateIndex
CREATE INDEX "calendar_events_calendar_promo_id_idx" ON "calendar_events"("calendar_promo_id");

-- CreateIndex
CREATE INDEX "calendar_issues_calendar_promo_id_idx" ON "calendar_issues"("calendar_promo_id");

-- AddForeignKey
ALTER TABLE "calendar_promo_activity" ADD CONSTRAINT "calendar_promo_activity_promo_id_fkey" FOREIGN KEY ("promo_id") REFERENCES "calendar_promos"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Tenant foreign keys (same pattern as neighbouring calendar tables).
ALTER TABLE "calendar_promos" ADD CONSTRAINT "calendar_promos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_promos" ADD CONSTRAINT "calendar_promos_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_promo_activity" ADD CONSTRAINT "calendar_promo_activity_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_calendar_promo_id_fkey" FOREIGN KEY ("calendar_promo_id") REFERENCES "calendar_promos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "calendar_issues" ADD CONSTRAINT "calendar_issues_calendar_promo_id_fkey" FOREIGN KEY ("calendar_promo_id") REFERENCES "calendar_promos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "calendar_cub_rounds" ADD CONSTRAINT "calendar_cub_rounds_calendar_promo_id_fkey" FOREIGN KEY ("calendar_promo_id") REFERENCES "calendar_promos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['calendar_promos', 'calendar_promo_activity']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (public.bypass_rls() OR organization_id = public.current_org_id()) WITH CHECK (public.bypass_rls() OR organization_id = public.current_org_id())', table_name);
  END LOOP;
END $$;

-- One-time backfill. For every Promo Analyzer promo the Calendar references (a pipeline track,
-- or an event / issue / CUB round promo_id), create one calendar promo with what the Calendar
-- showed, and point those rows' calendar_promo_id at it. Analyzer promos the Calendar never
-- referenced are not copied. Idempotent: a promo already copied (legacy_promo_id) is skipped,
-- and only rows whose promo was copied in this run are linked, so a second run changes nothing.
CREATE OR REPLACE FUNCTION public.calendar_backfill_own_promos() RETURNS integer
LANGUAGE plpgsql AS $fn$
DECLARE copied integer;
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);
  WITH refs AS (
    SELECT promo_id FROM calendar_promo_tracks
    UNION SELECT promo_id FROM calendar_events WHERE promo_id IS NOT NULL
    UNION SELECT promo_id FROM calendar_issues WHERE promo_id IS NOT NULL
    UNION SELECT promo_id FROM calendar_cub_rounds WHERE promo_id IS NOT NULL
  ),
  ins AS (
    INSERT INTO calendar_promos (
      id, organization_id, brand_id, name, promo_type, stage, writers, product, gurus, notes,
      launch_date, launch_estimated, launch_event_created, legacy_promo_id, updated_by_id, created_at, updated_at, deleted_at
    )
    SELECT
      gen_random_uuid(), p.organization_id, p.brand_id, left(p.title, 200), p.promo_type,
      coalesce(
        t.stage,
        (SELECT o.value FROM calendar_field_options o WHERE o.brand_id = p.brand_id AND o.field = 'promo.stage' ORDER BY o.sort_order, o.value LIMIT 1),
        'Idea'
      ),
      coalesce(t.writers, ARRAY[]::text[]), p.product, coalesce(p.gurus, ARRAY[]::text[]), t.notes,
      t.launch_date, coalesce(t.launch_estimated, false),
      -- A promo that already has an event on the calendar never gets an automatic launch event.
      EXISTS (SELECT 1 FROM calendar_events e WHERE e.promo_id = p.id AND e.deleted_at IS NULL),
      p.id, t.updated_by_id,
      coalesce(t.created_at, p.created_at), now(), p.deleted_at
    FROM promos p
    JOIN refs r ON r.promo_id = p.id
    LEFT JOIN calendar_promo_tracks t ON t.promo_id = p.id
    WHERE NOT EXISTS (SELECT 1 FROM calendar_promos c WHERE c.legacy_promo_id = p.id)
    RETURNING id, organization_id, legacy_promo_id
  ),
  act AS (
    INSERT INTO calendar_promo_activity (id, organization_id, promo_id, kind, note, created_at)
    SELECT gen_random_uuid(), ins.organization_id, ins.id, 'created', 'Copied from the earlier promo link', now() FROM ins
    RETURNING 1
  ),
  ev AS (
    UPDATE calendar_events e SET calendar_promo_id = ins.id FROM ins
    WHERE e.promo_id = ins.legacy_promo_id AND e.calendar_promo_id IS NULL
    RETURNING 1
  ),
  iss AS (
    UPDATE calendar_issues i SET calendar_promo_id = ins.id FROM ins
    WHERE i.promo_id = ins.legacy_promo_id AND i.calendar_promo_id IS NULL
    RETURNING 1
  ),
  cub AS (
    UPDATE calendar_cub_rounds c SET calendar_promo_id = ins.id FROM ins
    WHERE c.promo_id = ins.legacy_promo_id AND c.calendar_promo_id IS NULL
    RETURNING 1
  )
  -- Every data-modifying CTE runs to completion whether or not it is read here.
  SELECT count(*) INTO copied FROM ins;
  RETURN copied;
END
$fn$;

SELECT public.calendar_backfill_own_promos();
