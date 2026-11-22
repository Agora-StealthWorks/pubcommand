-- Admin console: packages copied with their promos into the console workspace. Additive only.
ALTER TABLE "promo_packages" ADD COLUMN "copied_from_id" UUID;
CREATE INDEX "promo_packages_copied_from_id_idx" ON "promo_packages"("copied_from_id");
