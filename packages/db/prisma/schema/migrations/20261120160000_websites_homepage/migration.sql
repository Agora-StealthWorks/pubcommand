-- Websites: homepage layout (featured story or hero banner, sections on/off). Additive only.
ALTER TABLE "web_sites" ADD COLUMN "homepage" JSONB NOT NULL DEFAULT '{}';
