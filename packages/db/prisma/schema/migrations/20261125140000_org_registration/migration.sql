-- Organizations can open a public sign-up page (off by default).
ALTER TABLE "org_settings" ADD COLUMN "registration_enabled" BOOLEAN NOT NULL DEFAULT false;
