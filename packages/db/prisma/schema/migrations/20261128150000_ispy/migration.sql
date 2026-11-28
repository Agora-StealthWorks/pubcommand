-- ISpy: shared competitor-email data (platform tables) plus one tenant table.

CREATE TABLE "ispy_publishers" (
    "id" UUID NOT NULL,
    "parent_id" UUID,
    "feed" TEXT NOT NULL DEFAULT 'FINPUB',
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'COMPETITOR',
    "domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "from_addresses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "website" TEXT,
    "notes" TEXT,
    "is_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "exclude_brands" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "linked_organization_id" UUID,
    "linked_brand_id" UUID,
    "hide_from_other_orgs" BOOLEAN NOT NULL DEFAULT false,
    "legacy_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ispy_publishers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ispy_publications" (
    "id" UUID NOT NULL,
    "publisher_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "linked_brand_id" UUID,
    "linked_organization_id" UUID,
    "linked_calendar_publication_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ispy_publications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ispy_lists" (
    "id" UUID NOT NULL,
    "publisher_id" UUID NOT NULL,
    "publication_id" UUID,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'FREE_EDITORIAL',
    "synonyms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_ignored" BOOLEAN NOT NULL DEFAULT false,
    "editorial_pub_code" TEXT,
    "dedicated_pub_code" TEXT,
    "notes" TEXT,
    "legacy_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ispy_lists_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ispy_inboxes" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "external_id" TEXT,
    "feed" TEXT NOT NULL DEFAULT 'FINPUB',
    "publisher_id" UUID,
    "publication_id" UUID,
    "list_id" UUID,
    "affiliate_seed" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "status_note" TEXT,
    "refresh_token_enc" TEXT,
    "access_token_enc" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "history_id" TEXT,
    "sync_cursor" TEXT,
    "last_sync_at" TIMESTAMP(3),
    "last_sync_error" TEXT,
    "last_message_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ispy_inboxes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ispy_routing_rules" (
    "id" UUID NOT NULL,
    "publisher_id" UUID,
    "publication_id" UUID,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "conditions" JSONB NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'ROUTE',
    "list_id" UUID,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "origin" TEXT NOT NULL DEFAULT 'STAFF',
    "hits" INTEGER NOT NULL DEFAULT 0,
    "last_hit_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ispy_routing_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ispy_list_candidates" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "publisher_id" UUID,
    "publication_id" UUID,
    "proposed_name" TEXT NOT NULL,
    "proposed_type" TEXT NOT NULL DEFAULT 'FREE_EDITORIAL',
    "signals" JSONB NOT NULL DEFAULT '[]',
    "proposed_rule" JSONB,
    "sample_email_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "email_count" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "result_list_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ispy_list_candidates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ispy_gurus" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "feed" TEXT NOT NULL DEFAULT 'FINPUB',
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "publisher_id" UUID,
    "notes" TEXT,
    "is_ignored" BOOLEAN NOT NULL DEFAULT false,
    "is_secondary_voice" BOOLEAN NOT NULL DEFAULT false,
    "secondary_publisher_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "primary_guru_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "legacy_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ispy_gurus_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ispy_guru_publications" (
    "guru_id" UUID NOT NULL,
    "publication_id" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'lead',

    CONSTRAINT "ispy_guru_publications_pkey" PRIMARY KEY ("guru_id","publication_id")
);

CREATE TABLE "ispy_guru_lists" (
    "guru_id" UUID NOT NULL,
    "list_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_ignored" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ispy_guru_lists_pkey" PRIMARY KEY ("guru_id","list_id")
);

CREATE TABLE "ispy_emails" (
    "id" UUID NOT NULL,
    "feed" TEXT NOT NULL DEFAULT 'FINPUB',
    "dedupe_key" TEXT NOT NULL,
    "inbox_id" UUID,
    "received_inbox_id" UUID,
    "provider_message_id" TEXT,
    "publisher_id" UUID,
    "publication_id" UUID,
    "list_id" UUID,
    "routed_by_rule_id" UUID,
    "route_status" TEXT NOT NULL DEFAULT 'UNSORTED',
    "route_reason" TEXT,
    "send_kind" TEXT NOT NULL DEFAULT 'EXTERNAL',
    "email_type" TEXT NOT NULL DEFAULT 'OTHER',
    "subject" TEXT NOT NULL,
    "from_name" TEXT,
    "from_address" TEXT NOT NULL,
    "to_address" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL,
    "html_body" TEXT,
    "text_body" TEXT NOT NULL DEFAULT '',
    "snippet" TEXT NOT NULL DEFAULT '',
    "links" JSONB NOT NULL DEFAULT '[]',
    "placement" TEXT,
    "raw_key" TEXT,
    "raw_size" INTEGER NOT NULL DEFAULT 0,
    "provider_meta" JSONB,
    "headers" JSONB NOT NULL DEFAULT '{}',
    "esp_name" TEXT,
    "campaign_id" TEXT,
    "list_id_header" TEXT,
    "auth_results" JSONB,
    "sending_ip" TEXT,
    "spam_score" DOUBLE PRECISION,
    "copy_id" UUID,
    "copy_match" TEXT,
    "promo_id" UUID,
    "promo_scan_status" TEXT NOT NULL DEFAULT 'PENDING',
    "promo_scan_error" TEXT,
    "gurus" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "org_brain_status" TEXT NOT NULL DEFAULT 'NONE',
    "legacy_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ispy_emails_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ispy_copies" (
    "id" UUID NOT NULL,
    "feed" TEXT NOT NULL DEFAULT 'FINPUB',
    "copy_hash" TEXT NOT NULL,
    "simhash" TEXT NOT NULL,
    "band0" INTEGER NOT NULL,
    "band1" INTEGER NOT NULL,
    "band2" INTEGER NOT NULL,
    "band3" INTEGER NOT NULL,
    "normalized" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "email_type" TEXT NOT NULL DEFAULT 'OTHER',
    "type_overridden" BOOLEAN NOT NULL DEFAULT false,
    "extraction" JSONB,
    "extraction_status" TEXT NOT NULL DEFAULT 'NONE',
    "extraction_error" TEXT,
    "deep_analysis" JSONB,
    "promo_id" UUID,
    "advertiser_id" UUID,
    "first_seen_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "first_seen_kind" TEXT NOT NULL DEFAULT 'EXTERNAL',
    "send_count" INTEGER NOT NULL DEFAULT 0,
    "list_count" INTEGER NOT NULL DEFAULT 0,
    "affiliate_count" INTEGER NOT NULL DEFAULT 0,
    "subject_count" INTEGER NOT NULL DEFAULT 0,
    "merged_into_id" UUID,
    "brain_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ispy_copies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ispy_advertisers" (
    "id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "label_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "is_platform" BOOLEAN NOT NULL DEFAULT false,
    "publisher_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ispy_advertisers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ispy_landing_pages" (
    "id" UUID NOT NULL,
    "canonical_key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "final_url" TEXT NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 0,
    "hops" INTEGER NOT NULL DEFAULT 0,
    "rel_canonical" TEXT,
    "og_url" TEXT,
    "headline" TEXT,
    "headline_source" TEXT,
    "site_name" TEXT,
    "description" TEXT,
    "text" TEXT NOT NULL DEFAULT '',
    "text_hash" TEXT,
    "simhash" TEXT,
    "video_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "kind" TEXT NOT NULL DEFAULT 'VSL',
    "snapshot_key" TEXT,
    "transcript_status" TEXT NOT NULL DEFAULT 'NOT_DETECTED',
    "transcript_url" TEXT,
    "transcript_link_text" TEXT,
    "transcript_text" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "promo_id" UUID,

    CONSTRAINT "ispy_landing_pages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ispy_promos" (
    "id" UUID NOT NULL,
    "feed" TEXT NOT NULL DEFAULT 'FINPUB',
    "canonical_key" TEXT NOT NULL,
    "content_key" TEXT,
    "landing_url" TEXT NOT NULL,
    "landing_host" TEXT NOT NULL,
    "advertiser_id" UUID NOT NULL,
    "advertiser_label" TEXT,
    "headline" TEXT,
    "headline_source" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'VSL',
    "last_status" INTEGER,
    "video_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "simhash" TEXT,
    "is_internal" BOOLEAN NOT NULL DEFAULT false,
    "first_seen_on" DATE NOT NULL,
    "last_seen_on" DATE NOT NULL,
    "days_detected" INTEGER NOT NULL DEFAULT 1,
    "send_count" INTEGER NOT NULL DEFAULT 0,
    "affiliate_count" INTEGER NOT NULL DEFAULT 0,
    "merged_into_id" UUID,
    "legacy_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ispy_promos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ispy_promo_aliases" (
    "key" TEXT NOT NULL,
    "promo_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ispy_promo_aliases_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "ispy_promo_sightings" (
    "id" UUID NOT NULL,
    "promo_id" UUID NOT NULL,
    "email_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "publisher_id" UUID,
    "list_id" UUID,
    "send_kind" TEXT NOT NULL DEFAULT 'EXTERNAL',
    "subject" TEXT NOT NULL,
    "raw_url" TEXT NOT NULL,
    "is_first_ever" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ispy_promo_sightings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ispy_promo_blocks" (
    "match_key" TEXT NOT NULL,
    "label" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ispy_promo_blocks_pkey" PRIMARY KEY ("match_key")
);

CREATE TABLE "ispy_reports" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" UUID NOT NULL,
    "duplicate_of_id" UUID,
    "note" TEXT,
    "reporter_id" UUID,
    "reporter_org_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ispy_reports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ispy_topics" (
    "id" UUID NOT NULL,
    "feed" TEXT NOT NULL DEFAULT 'FINPUB',
    "name" TEXT NOT NULL,
    "synonyms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_ignored" BOOLEAN NOT NULL DEFAULT false,
    "is_secondary" BOOLEAN NOT NULL DEFAULT false,
    "legacy_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ispy_topics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ispy_trend_weeks" (
    "id" UUID NOT NULL,
    "feed" TEXT NOT NULL,
    "week_start" DATE NOT NULL,
    "stats" JSONB NOT NULL,
    "narrative" TEXT,
    "model" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ispy_trend_weeks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ispy_feed_access" (
    "org_id" UUID NOT NULL,
    "feed" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ispy_feed_access_pkey" PRIMARY KEY ("org_id","feed")
);

CREATE TABLE "ispy_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ispy_settings_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "ispy_analyzer_sends" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" UUID NOT NULL,
    "promo_id" UUID NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ispy_analyzer_sends_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ispy_publishers_legacy_id_key" ON "ispy_publishers"("legacy_id");

CREATE INDEX "ispy_publishers_feed_type_idx" ON "ispy_publishers"("feed", "type");

CREATE INDEX "ispy_publishers_parent_id_idx" ON "ispy_publishers"("parent_id");

CREATE INDEX "ispy_publishers_linked_organization_id_idx" ON "ispy_publishers"("linked_organization_id");

CREATE UNIQUE INDEX "ispy_publications_linked_calendar_publication_id_key" ON "ispy_publications"("linked_calendar_publication_id");

CREATE INDEX "ispy_publications_publisher_id_idx" ON "ispy_publications"("publisher_id");

CREATE INDEX "ispy_publications_linked_organization_id_idx" ON "ispy_publications"("linked_organization_id");

CREATE UNIQUE INDEX "ispy_lists_legacy_id_key" ON "ispy_lists"("legacy_id");

CREATE INDEX "ispy_lists_publisher_id_idx" ON "ispy_lists"("publisher_id");

CREATE INDEX "ispy_lists_publication_id_idx" ON "ispy_lists"("publication_id");

CREATE UNIQUE INDEX "ispy_inboxes_address_key" ON "ispy_inboxes"("address");

CREATE INDEX "ispy_inboxes_list_id_idx" ON "ispy_inboxes"("list_id");

CREATE INDEX "ispy_inboxes_publication_id_idx" ON "ispy_inboxes"("publication_id");

CREATE INDEX "ispy_inboxes_provider_status_idx" ON "ispy_inboxes"("provider", "status");

CREATE INDEX "ispy_routing_rules_enabled_priority_idx" ON "ispy_routing_rules"("enabled", "priority");

CREATE UNIQUE INDEX "ispy_list_candidates_key_key" ON "ispy_list_candidates"("key");

CREATE INDEX "ispy_list_candidates_status_idx" ON "ispy_list_candidates"("status");

CREATE UNIQUE INDEX "ispy_gurus_legacy_id_key" ON "ispy_gurus"("legacy_id");

CREATE UNIQUE INDEX "ispy_gurus_feed_name_key" ON "ispy_gurus"("feed", "name");

CREATE UNIQUE INDEX "ispy_emails_dedupe_key_key" ON "ispy_emails"("dedupe_key");

CREATE UNIQUE INDEX "ispy_emails_legacy_id_key" ON "ispy_emails"("legacy_id");

CREATE INDEX "ispy_emails_feed_received_at_idx" ON "ispy_emails"("feed", "received_at");

CREATE INDEX "ispy_emails_publisher_id_received_at_idx" ON "ispy_emails"("publisher_id", "received_at");

CREATE INDEX "ispy_emails_publication_id_received_at_idx" ON "ispy_emails"("publication_id", "received_at");

CREATE INDEX "ispy_emails_list_id_received_at_idx" ON "ispy_emails"("list_id", "received_at");

CREATE INDEX "ispy_emails_copy_id_idx" ON "ispy_emails"("copy_id");

CREATE INDEX "ispy_emails_promo_id_idx" ON "ispy_emails"("promo_id");

CREATE INDEX "ispy_emails_route_status_idx" ON "ispy_emails"("route_status");

CREATE INDEX "ispy_emails_campaign_id_idx" ON "ispy_emails"("campaign_id");

CREATE INDEX "ispy_emails_promo_scan_status_idx" ON "ispy_emails"("promo_scan_status");

CREATE INDEX "ispy_copies_feed_copy_hash_idx" ON "ispy_copies"("feed", "copy_hash");

CREATE INDEX "ispy_copies_feed_band0_idx" ON "ispy_copies"("feed", "band0");

CREATE INDEX "ispy_copies_feed_band1_idx" ON "ispy_copies"("feed", "band1");

CREATE INDEX "ispy_copies_feed_band2_idx" ON "ispy_copies"("feed", "band2");

CREATE INDEX "ispy_copies_feed_band3_idx" ON "ispy_copies"("feed", "band3");

CREATE INDEX "ispy_copies_last_seen_at_idx" ON "ispy_copies"("last_seen_at");

CREATE UNIQUE INDEX "ispy_advertisers_domain_key" ON "ispy_advertisers"("domain");

CREATE UNIQUE INDEX "ispy_landing_pages_canonical_key_key" ON "ispy_landing_pages"("canonical_key");

CREATE INDEX "ispy_landing_pages_promo_id_idx" ON "ispy_landing_pages"("promo_id");

CREATE UNIQUE INDEX "ispy_promos_canonical_key_key" ON "ispy_promos"("canonical_key");

CREATE UNIQUE INDEX "ispy_promos_legacy_id_key" ON "ispy_promos"("legacy_id");

CREATE INDEX "ispy_promos_feed_last_seen_on_idx" ON "ispy_promos"("feed", "last_seen_on");

CREATE INDEX "ispy_promos_feed_first_seen_on_idx" ON "ispy_promos"("feed", "first_seen_on");

CREATE INDEX "ispy_promos_content_key_idx" ON "ispy_promos"("content_key");

CREATE INDEX "ispy_promos_advertiser_id_idx" ON "ispy_promos"("advertiser_id");

CREATE INDEX "ispy_promo_aliases_promo_id_idx" ON "ispy_promo_aliases"("promo_id");

CREATE INDEX "ispy_promo_sightings_day_idx" ON "ispy_promo_sightings"("day");

CREATE INDEX "ispy_promo_sightings_publisher_id_idx" ON "ispy_promo_sightings"("publisher_id");

CREATE UNIQUE INDEX "ispy_promo_sightings_promo_id_email_id_key" ON "ispy_promo_sightings"("promo_id", "email_id");

CREATE INDEX "ispy_reports_status_created_at_idx" ON "ispy_reports"("status", "created_at");

CREATE UNIQUE INDEX "ispy_topics_legacy_id_key" ON "ispy_topics"("legacy_id");

CREATE UNIQUE INDEX "ispy_topics_feed_name_key" ON "ispy_topics"("feed", "name");

CREATE UNIQUE INDEX "ispy_trend_weeks_feed_week_start_key" ON "ispy_trend_weeks"("feed", "week_start");

CREATE UNIQUE INDEX "ispy_analyzer_sends_organization_id_target_type_target_id_key" ON "ispy_analyzer_sends"("organization_id", "target_type", "target_id");

ALTER TABLE "ispy_publishers" ADD CONSTRAINT "ispy_publishers_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "ispy_publishers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ispy_publications" ADD CONSTRAINT "ispy_publications_publisher_id_fkey" FOREIGN KEY ("publisher_id") REFERENCES "ispy_publishers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ispy_lists" ADD CONSTRAINT "ispy_lists_publisher_id_fkey" FOREIGN KEY ("publisher_id") REFERENCES "ispy_publishers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ispy_lists" ADD CONSTRAINT "ispy_lists_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "ispy_publications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ispy_inboxes" ADD CONSTRAINT "ispy_inboxes_publisher_id_fkey" FOREIGN KEY ("publisher_id") REFERENCES "ispy_publishers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ispy_inboxes" ADD CONSTRAINT "ispy_inboxes_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "ispy_publications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ispy_inboxes" ADD CONSTRAINT "ispy_inboxes_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "ispy_lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ispy_routing_rules" ADD CONSTRAINT "ispy_routing_rules_publisher_id_fkey" FOREIGN KEY ("publisher_id") REFERENCES "ispy_publishers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ispy_routing_rules" ADD CONSTRAINT "ispy_routing_rules_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "ispy_publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ispy_gurus" ADD CONSTRAINT "ispy_gurus_publisher_id_fkey" FOREIGN KEY ("publisher_id") REFERENCES "ispy_publishers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ispy_guru_publications" ADD CONSTRAINT "ispy_guru_publications_guru_id_fkey" FOREIGN KEY ("guru_id") REFERENCES "ispy_gurus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ispy_guru_publications" ADD CONSTRAINT "ispy_guru_publications_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "ispy_publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ispy_guru_lists" ADD CONSTRAINT "ispy_guru_lists_guru_id_fkey" FOREIGN KEY ("guru_id") REFERENCES "ispy_gurus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ispy_guru_lists" ADD CONSTRAINT "ispy_guru_lists_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "ispy_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ispy_emails" ADD CONSTRAINT "ispy_emails_inbox_id_fkey" FOREIGN KEY ("inbox_id") REFERENCES "ispy_inboxes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ispy_emails" ADD CONSTRAINT "ispy_emails_received_inbox_id_fkey" FOREIGN KEY ("received_inbox_id") REFERENCES "ispy_inboxes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ispy_emails" ADD CONSTRAINT "ispy_emails_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "ispy_lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ispy_emails" ADD CONSTRAINT "ispy_emails_copy_id_fkey" FOREIGN KEY ("copy_id") REFERENCES "ispy_copies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ispy_emails" ADD CONSTRAINT "ispy_emails_promo_id_fkey" FOREIGN KEY ("promo_id") REFERENCES "ispy_promos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ispy_advertisers" ADD CONSTRAINT "ispy_advertisers_publisher_id_fkey" FOREIGN KEY ("publisher_id") REFERENCES "ispy_publishers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ispy_landing_pages" ADD CONSTRAINT "ispy_landing_pages_promo_id_fkey" FOREIGN KEY ("promo_id") REFERENCES "ispy_promos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ispy_promos" ADD CONSTRAINT "ispy_promos_advertiser_id_fkey" FOREIGN KEY ("advertiser_id") REFERENCES "ispy_advertisers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ispy_promo_aliases" ADD CONSTRAINT "ispy_promo_aliases_promo_id_fkey" FOREIGN KEY ("promo_id") REFERENCES "ispy_promos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ispy_promo_sightings" ADD CONSTRAINT "ispy_promo_sightings_promo_id_fkey" FOREIGN KEY ("promo_id") REFERENCES "ispy_promos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Platform tables: no organization_id. Only code that sets app.bypass_rls (ispyDb) may read or write.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['ispy_publishers', 'ispy_publications', 'ispy_lists', 'ispy_inboxes', 'ispy_routing_rules', 'ispy_list_candidates', 'ispy_gurus', 'ispy_guru_publications', 'ispy_guru_lists', 'ispy_emails', 'ispy_copies', 'ispy_advertisers', 'ispy_landing_pages', 'ispy_promos', 'ispy_promo_aliases', 'ispy_promo_sightings', 'ispy_promo_blocks', 'ispy_reports', 'ispy_topics', 'ispy_trend_weeks', 'ispy_feed_access', 'ispy_settings']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS platform_only ON %I', table_name);
    EXECUTE format('CREATE POLICY platform_only ON %I USING (public.bypass_rls()) WITH CHECK (public.bypass_rls())', table_name);
  END LOOP;
END $$;

-- The one tenant table: an organization's Promo Analyzer copies of ISpy items.
ALTER TABLE "ispy_analyzer_sends" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ispy_analyzer_sends" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ispy_analyzer_sends";
CREATE POLICY tenant_isolation ON "ispy_analyzer_sends" USING (public.bypass_rls() OR organization_id = public.current_org_id()) WITH CHECK (public.bypass_rls() OR organization_id = public.current_org_id());
ALTER TABLE "ispy_analyzer_sends" ADD CONSTRAINT "ispy_analyzer_sends_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
