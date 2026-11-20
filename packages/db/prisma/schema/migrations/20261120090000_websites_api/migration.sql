-- Websites: the public site can run as its own app (separate repo and Railway project)
-- that reads from PubCommand over an API. Additive only.
ALTER TABLE "web_sites" ADD COLUMN "public_url" TEXT;
ALTER TABLE "web_sites" ADD COLUMN "api_key_hash" TEXT;
ALTER TABLE "web_sites" ADD COLUMN "api_key_prefix" TEXT;
ALTER TABLE "web_sites" ADD COLUMN "api_key_created_at" TIMESTAMP(3);
CREATE UNIQUE INDEX "web_sites_api_key_hash_key" ON "web_sites"("api_key_hash");
