-- Dashboard app cards set by platform staff (Admin → App cards). Platform table: no organization_id, no RLS.
CREATE TABLE "app_cards" (
    "module_id" TEXT NOT NULL,
    "name" TEXT,
    "on_dashboard" BOOLEAN,
    "position" INTEGER,
    "image_mime" TEXT,
    "image_data" BYTEA,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "app_cards_pkey" PRIMARY KEY ("module_id")
);
