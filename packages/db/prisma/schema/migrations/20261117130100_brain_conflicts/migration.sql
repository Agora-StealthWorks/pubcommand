-- Main-Brain conflict review (console only). Additive: three new platform tables.
-- Like main_brain_*: no organization_id column (entity_organization_id is provenance,
-- so tenantDb() never exposes these models) and RLS allows only app.bypass_rls.

-- CreateEnum
CREATE TYPE "MainBrainConflictStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "main_brain_conflict_checks" (
    "id" UUID NOT NULL,
    "entity_kind" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "entity_organization_id" UUID NOT NULL,
    "entity_brand_id" UUID NOT NULL,
    "entity_name" TEXT NOT NULL,
    "entity_code" TEXT,
    "facts" JSONB NOT NULL,
    "facts_hash" TEXT NOT NULL,
    "notes_hash" TEXT NOT NULL,
    "note_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "status" TEXT NOT NULL DEFAULT 'queued',
    "reason" TEXT,
    "ai_status" TEXT,
    "ai_reason" TEXT,
    "ai_usage" JSONB,
    "error" TEXT,
    "checked_at" TIMESTAMP(3),
    "checked_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "main_brain_conflict_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "main_brain_conflicts" (
    "id" UUID NOT NULL,
    "check_id" UUID NOT NULL,
    "entity_kind" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "entity_organization_id" UUID NOT NULL,
    "entity_brand_id" UUID NOT NULL,
    "fact_key" TEXT NOT NULL,
    "fact_value" TEXT NOT NULL,
    "fact_hash" TEXT NOT NULL,
    "note_id" UUID NOT NULL,
    "note_title" TEXT NOT NULL,
    "note_hash" TEXT NOT NULL,
    "note_says" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "note_value" TEXT,
    "suggested_value" TEXT,
    "layer" TEXT NOT NULL,
    "rule" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" "MainBrainConflictStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "reason" TEXT,
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMP(3),
    "suggestion" JSONB,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "main_brain_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "main_brain_note_flags" (
    "note_id" UUID NOT NULL,
    "superseded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_by_id" UUID,
    "reason" TEXT,
    "conflict_id" UUID,

    CONSTRAINT "main_brain_note_flags_pkey" PRIMARY KEY ("note_id")
);

-- CreateIndex
CREATE INDEX "main_brain_conflict_checks_entity_organization_id_entity_br_idx" ON "main_brain_conflict_checks"("entity_organization_id", "entity_brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "main_brain_conflict_checks_entity_kind_entity_id_key" ON "main_brain_conflict_checks"("entity_kind", "entity_id");

-- CreateIndex
CREATE INDEX "main_brain_conflicts_status_idx" ON "main_brain_conflicts"("status");

-- CreateIndex
CREATE INDEX "main_brain_conflicts_entity_organization_id_entity_brand_id_idx" ON "main_brain_conflicts"("entity_organization_id", "entity_brand_id");

-- CreateIndex
CREATE INDEX "main_brain_conflicts_note_id_idx" ON "main_brain_conflicts"("note_id");

-- CreateIndex
CREATE UNIQUE INDEX "main_brain_conflicts_entity_kind_entity_id_fact_key_note_id_key" ON "main_brain_conflicts"("entity_kind", "entity_id", "fact_key", "note_id");

-- AddForeignKey
ALTER TABLE "main_brain_conflicts" ADD CONSTRAINT "main_brain_conflicts_check_id_fkey" FOREIGN KEY ("check_id") REFERENCES "main_brain_conflict_checks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (by hand: no relation fields on shared models)
ALTER TABLE "main_brain_conflicts" ADD CONSTRAINT "main_brain_conflicts_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "main_brain_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "main_brain_conflicts" ADD CONSTRAINT "main_brain_conflicts_entity_organization_id_fkey" FOREIGN KEY ("entity_organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "main_brain_conflicts" ADD CONSTRAINT "main_brain_conflicts_entity_brand_id_fkey" FOREIGN KEY ("entity_brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "main_brain_conflict_checks" ADD CONSTRAINT "main_brain_conflict_checks_entity_organization_id_fkey" FOREIGN KEY ("entity_organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "main_brain_conflict_checks" ADD CONSTRAINT "main_brain_conflict_checks_entity_brand_id_fkey" FOREIGN KEY ("entity_brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "main_brain_note_flags" ADD CONSTRAINT "main_brain_note_flags_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "main_brain_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Platform tables: only code that sets app.bypass_rls may read or write them.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['main_brain_conflict_checks', 'main_brain_conflicts', 'main_brain_note_flags']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS platform_only ON %I', table_name);
    EXECUTE format('CREATE POLICY platform_only ON %I USING (public.bypass_rls()) WITH CHECK (public.bypass_rls())', table_name);
  END LOOP;
END $$;
