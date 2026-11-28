-- A short description per module, shown on episode grid cards.
ALTER TABLE "funnel_days" ADD COLUMN IF NOT EXISTS "summary" TEXT NOT NULL DEFAULT '';
