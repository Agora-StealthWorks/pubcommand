-- Promo Analyzer: live streamed analysis text (sectioned pipeline). Additive only.
ALTER TABLE "promos" ADD COLUMN IF NOT EXISTS "analysis_live" TEXT;
ALTER TABLE "promos" ADD COLUMN IF NOT EXISTS "analysis_started_at" TIMESTAMP(3);
