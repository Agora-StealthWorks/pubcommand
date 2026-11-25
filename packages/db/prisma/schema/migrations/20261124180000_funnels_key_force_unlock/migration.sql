-- Funnels: email links (?k=) can force-unlock modules under scheduled / watch % progression. Additive only.
ALTER TABLE "funnels" ADD COLUMN IF NOT EXISTS "key_force_unlock" BOOLEAN NOT NULL DEFAULT false;
