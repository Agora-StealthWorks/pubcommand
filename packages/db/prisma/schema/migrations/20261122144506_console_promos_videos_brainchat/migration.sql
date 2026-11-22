-- Admin console: copy markers for promos and videos brought over from other organizations,
-- and the BrainChat tables (platform-only, like main_brain_*). Additive only.

-- AlterTable
ALTER TABLE "intel_videos" ADD COLUMN     "copied_from_id" UUID;

-- AlterTable
ALTER TABLE "promos" ADD COLUMN     "copied_from_id" UUID;

-- CreateTable
CREATE TABLE "main_brain_chats" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'New chat',
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "main_brain_chats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "main_brain_chat_messages" (
    "id" UUID NOT NULL,
    "chat_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'DONE',
    "error" TEXT,
    "uploads" JSONB NOT NULL DEFAULT '[]',
    "activity" JSONB NOT NULL DEFAULT '[]',
    "model" TEXT,
    "usage" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "main_brain_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "main_brain_chats_created_by_id_updated_at_idx" ON "main_brain_chats"("created_by_id", "updated_at");

-- CreateIndex
CREATE INDEX "main_brain_chat_messages_chat_id_created_at_idx" ON "main_brain_chat_messages"("chat_id", "created_at");

-- CreateIndex
CREATE INDEX "intel_videos_copied_from_id_idx" ON "intel_videos"("copied_from_id");

-- CreateIndex
CREATE INDEX "promos_copied_from_id_idx" ON "promos"("copied_from_id");

-- AddForeignKey
ALTER TABLE "main_brain_chat_messages" ADD CONSTRAINT "main_brain_chat_messages_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "main_brain_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- BrainChat tables belong to no organization: only platform code that sets
-- app.bypass_rls may read or write them.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['main_brain_chats', 'main_brain_chat_messages']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS platform_only ON %I', table_name);
    EXECUTE format('CREATE POLICY platform_only ON %I USING (public.bypass_rls()) WITH CHECK (public.bypass_rls())', table_name);
  END LOOP;
END $$;
