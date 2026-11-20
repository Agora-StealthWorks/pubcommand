-- Websites: members can sign in with a password (the emailed link stays as reset / first sign-in). Additive only.
ALTER TABLE "web_members" ADD COLUMN "password_hash" TEXT;
ALTER TABLE "web_members" ADD COLUMN "password_set_at" TIMESTAMP(3);
