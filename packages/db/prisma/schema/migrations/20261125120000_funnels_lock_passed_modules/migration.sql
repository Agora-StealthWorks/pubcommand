-- Funnels: a module can lock again once a later one is open, and optionally leave the navigation. Additive only.
ALTER TABLE "funnels" ADD COLUMN IF NOT EXISTS "lock_passed_modules" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "funnels" ADD COLUMN IF NOT EXISTS "hide_passed_modules" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "funnels" ADD COLUMN IF NOT EXISTS "locked_passed_msg" TEXT NOT NULL DEFAULT '{day} is no longer available. {next_day} is open now.';
