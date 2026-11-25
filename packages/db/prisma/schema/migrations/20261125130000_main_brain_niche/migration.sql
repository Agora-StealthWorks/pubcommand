-- Master Brain notes carry a niche so finance and health knowledge never mix.
ALTER TABLE "main_brain_notes" ADD COLUMN "niche" TEXT NOT NULL DEFAULT 'general';
CREATE INDEX "main_brain_notes_niche_idx" ON "main_brain_notes"("niche");
ALTER TABLE "main_brain_imports" ADD COLUMN "niche" TEXT NOT NULL DEFAULT 'general';

-- Existing notes take the niche of the brand they came from.
UPDATE "main_brain_notes" n
SET "niche" = b."niche"
FROM "brands" b
WHERE n."origin_brand_id" = b."id" AND b."niche" IN ('finance', 'health');

-- Learned notes without a brand: the organization's niche when all its brands share one.
UPDATE "main_brain_notes" n
SET "niche" = o."niche"
FROM (
  SELECT "organization_id", MIN("niche") AS "niche"
  FROM "brands"
  GROUP BY "organization_id"
  HAVING COUNT(DISTINCT "niche") = 1
) o
WHERE n."origin_brand_id" IS NULL
  AND n."origin_organization_id" = o."organization_id"
  AND o."niche" IN ('finance', 'health');

-- A note whose markdown already names a niche keeps it.
UPDATE "main_brain_notes"
SET "niche" = lower(substring(substring("body" from '^---[ \t]*\r?\n(.*?)\r?\n---') from '(?:^|\n)niche[ \t]*:[ \t]*["'']?([A-Za-z]+)'))
WHERE lower(substring(substring("body" from '^---[ \t]*\r?\n(.*?)\r?\n---') from '(?:^|\n)niche[ \t]*:[ \t]*["'']?([A-Za-z]+)')) IN ('finance', 'health', 'general');

-- Every note carries its niche in its own markdown frontmatter too (`niche: finance`).
-- Notes with a frontmatter block get the line added at the top of it; others get a new block.
UPDATE "main_brain_notes"
SET "body" = CASE
  WHEN "body" ~ '^---[ \t]*\r?\n.*?\r?\n---' THEN regexp_replace("body", '^(---[ \t]*\r?\n)', '\1niche: ' || "niche" || E'\n')
  ELSE E'---\nniche: ' || "niche" || E'\n---\n\n' || "body"
END
WHERE coalesce(substring("body" from '^---[ \t]*\r?\n(.*?)\r?\n---'), '') !~* '(^|\n)niche[ \t]*:';
