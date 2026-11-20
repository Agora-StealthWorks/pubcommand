/**
 * Calendar features switched off for now (Stephen, 2026-11-20). Their code, tables and data
 * stay in place; flipping a flag to true brings the feature back (nav tab, pages, routes,
 * actions and, where noted, its job in apps/web/src/jobs/index.ts).
 */

/** CUB Collector: /editorial/cub*, public /p/cub/* pages, Setup → Emails. Job: editorialCubEmails. */
export const CUB_COLLECTOR_ENABLED = false;

/** Send stats: /editorial/stats (CSV import, list mappings), the stats box on issue pages, the "Stats" chip in the list. */
export const SEND_STATS_ENABLED = false;

/** What's Working: /editorial/whats-working (AI summary of the last 30 days of send stats). */
export const WHATS_WORKING_ENABLED = false;

/** Editorial analytics: /editorial/analytics (send stats rolled up by week / month / quarter). */
export const EDITORIAL_ANALYTICS_ENABLED = false;

/** Airtable two-way sync: Setup → Airtable, write-back on save. Job: editorialAirtableSync. */
export const AIRTABLE_SYNC_ENABLED = false;
