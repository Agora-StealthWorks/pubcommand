-- Guru profiles: link call-archive experts and Track Record positions to Publication Setup editors.
-- Additive only: three nullable columns, indexes and foreign keys (ON DELETE SET NULL). The tables already
-- have row-level security; new columns are covered by the existing tenant_isolation policies.

-- AlterTable
ALTER TABLE "track_experts" ADD COLUMN "editor_id" UUID;

-- AlterTable
ALTER TABLE "track_portfolios" ADD COLUMN "default_editor_id" UUID;

-- AlterTable
ALTER TABLE "track_positions" ADD COLUMN "editor_id" UUID;

-- CreateIndex
CREATE INDEX "track_experts_editor_id_idx" ON "track_experts"("editor_id");

-- CreateIndex
CREATE INDEX "track_positions_editor_id_idx" ON "track_positions"("editor_id");

-- CreateIndex
CREATE INDEX "track_portfolios_default_editor_id_idx" ON "track_portfolios"("default_editor_id");

-- AddForeignKey
ALTER TABLE "track_experts" ADD CONSTRAINT "track_experts_editor_id_fkey" FOREIGN KEY ("editor_id") REFERENCES "pubsetup_editors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "track_portfolios" ADD CONSTRAINT "track_portfolios_default_editor_id_fkey" FOREIGN KEY ("default_editor_id") REFERENCES "pubsetup_editors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "track_positions" ADD CONSTRAINT "track_positions_editor_id_fkey" FOREIGN KEY ("editor_id") REFERENCES "pubsetup_editors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: link each existing expert to the editor of the same brand with the same name (case-insensitive),
-- only where that name is unique among the brand's live editors AND among its live unlinked experts.
-- Ambiguous names stay unlinked for a person to set on the archive's manage page. No other value changes.
SELECT set_config('app.bypass_rls', 'on', false);

WITH editors AS (
  SELECT "id", "brand_id", lower(btrim("name")) AS n
  FROM "pubsetup_editors"
  WHERE "deleted_at" IS NULL
), unique_editors AS (
  SELECT min("id"::text)::uuid AS "id", "brand_id", n FROM editors GROUP BY "brand_id", n HAVING count(*) = 1
), experts AS (
  SELECT "id", "brand_id", lower(btrim("name")) AS n
  FROM "track_experts"
  WHERE "deleted_at" IS NULL AND "editor_id" IS NULL
), unique_experts AS (
  SELECT min("id"::text)::uuid AS "id", "brand_id", n FROM experts GROUP BY "brand_id", n HAVING count(*) = 1
)
UPDATE "track_experts" x
SET "editor_id" = e."id"
FROM unique_experts ux
JOIN unique_editors e ON e."brand_id" = ux."brand_id" AND e.n = ux.n
WHERE x."id" = ux."id";

SELECT set_config('app.bypass_rls', '', false);
