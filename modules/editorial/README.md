# Calendar

Module id and route stay `editorial` / `/editorial`. One calendar per brand: live events, editorial issues and the Calendar's own promo pipeline.

| | |
| --- | --- |
| Permissions | `editorial.read` (see everything), `editorial.write` (add and edit events, issues and promos) |
| Tables | `packages/db/prisma/schema/marketing-calendar.prisma` (all per brand) |
| Server code | `apps/web/src/features/calendar/` |
| Pages | `apps/web/src/app/sites/org/[slug]/editorial/**`, public CUB pages in `apps/web/src/app/sites/public/[slug]/cub/**` |

## Pure logic (unit tested in `calendar.test.ts`)

- `stages.ts`: the three stages (marketing start → event → marketing end), running-list filters, month-grid and timeline placement.
- `recurrence.ts`: cadences and the two edit scopes. A "single" edit never touches the series. A "following" edit copies the shared copy to later occurrences, shifts their dates by the anchor's move, and never copies dates or results. A cadence change re-plans only the occurrences after the anchor.
- `stats.ts`: CSV parsing, column guessing, matching by mail date + publication code with the subject line as the tie-breaker.
- `analytics.ts`: week/month/quarter rollups with weighted rates (sums divided by sums, never averaged percentages).
- `whats-working.ts`: ranks the last 30 days of sends from data; the AI only explains (prompt, schema, normalizer).
- `cub.ts`: four anonymous 0–10 scores, averages, default deadline (2 business days, 3:30 pm Eastern), zip names.
- `brain.ts`: Brain notes (`calendar-issue:<id>`, `calendar-event:<id>`).

## Public CUB links

`/p/cub/r/<token>` (reviewer) and `/p/cub/o/<token>` (owner) on the organization host. Middleware rewrites `/p/*` to `/sites/public/<slug>/*`, outside the signed-in org layout. The organization comes from the host; the 128-bit token is the credential.

## Added in calendar2

- `emails.ts`: CUB email kinds (`cub-request`, `cub-reminder`, `cub-owner-confirm`, `cub-complete`), merge fields, defaults, and `planCubTick`: the reminder goes at 9:05 am ET on the business day before the deadline (skipped when the round started after that moment), "revisions ready" after the deadline. Stamp columns make the `editorial.cub-emails` job (every 15 min) idempotent. Templates and the reviewer group are edited under Setup → Emails; without `RESEND_API_KEY` emails are logged and the UI says email is not set up.
- `options.ts`: per-brand option lists (event stage/type/format, issue status/type, promo stage); defaults until a brand saves its own. Promo pipeline columns.
- `stats.ts`: saved list mappings (label → publication code, empty = ignore) win over guessing.
- `trash.ts`: restore rules. A series is trashed with its live occurrences at one instant and restored with exactly those.
- `recurrence.ts` → `extensionPlan`: the `editorial.series-extend` job keeps open-ended series planned six months ahead, never re-creating deleted occurrences.
- `airtable.ts`: optional two-way sync with a brand's own base (token sealed with `AUTH_SECRET`), field mapping by name, editable-fields-only write-back, pull upsert by record id; conflict rule in `pullDecision` (Postgres wins unless the Airtable record is newer). Job `editorial.airtable-sync` (hourly).
- `tickers.ts`: ticker mentions and price moves from market data (finance brands only; job `editorial.ticker-prices`).
- `editorial.brain-catchup` teaches the brand Brain about issues/events saved outside the calendar forms (Mini-Blog posts, jobs, Airtable pulls), using `brainTaughtAt`.
- (Superseded by calendar3 below.) Promos used to be Promo Analyzer promos (`promo_id`, `calendar_promo_tracks`).

## Switched off for now (calendar3)

`features.ts` holds one flag per feature. Each is `false`; set it to `true` to bring the feature back. Code, tables and data stay in place.

| Flag | What it hides | Also re-add |
| --- | --- | --- |
| `CUB_COLLECTOR_ENABLED` | CUB Collector tab, `/editorial/cub*` pages and file routes, public `/p/cub/*` reviewer/owner pages and routes (404), Setup → Emails (CUB emails only), CUB actions | `editorialCubEmails` in `apps/web/src/jobs/index.ts` |
| `SEND_STATS_ENABLED` | Send stats tab and `/editorial/stats` (404), CSV import and list-mapping actions, the stats box on issue pages, the "Stats" chip in the list | — (no job) |
| `WHATS_WORKING_ENABLED` | What's Working tab and `/editorial/whats-working` (404), its regenerate action | — (never had a job) |
| `EDITORIAL_ANALYTICS_ENABLED` | Analytics tab and `/editorial/analytics` (404) | — |
| `AIRTABLE_SYNC_ENABLED` | Setup → Airtable, Airtable actions, write-back after saving an event or issue | `editorialAirtableSync` in `apps/web/src/jobs/index.ts` |

Nav now: List · Calendar · Timeline · Promos · Tickers (finance brands) · Setup. Brain notes for issues still include send stats already imported; nothing new arrives while send stats are off.

## Promos (calendar3)

The Calendar has its own promos (`calendar_promos`, history in `calendar_promo_activity`). Nothing in the Calendar reads Promo Analyzer, and Promo Analyzer reads nothing from the Calendar.

- Fields follow MTARIX: name, type, stage (Setup → Field options → promo stages), format, publication and editors (from Publication Setup), copywriters, notes, targeted date, launch date + estimate, copy platform / hotlist page / promo file links. `cub_draft_url`, `copy_platform`, `airtable_id` exist for later and are not used.
- Pages: `/editorial/promos` (board, quick stage moves), `/editorial/promos/new`, `/editorial/promos/<id>` (details, linked events and issues, history, delete), `/editorial/promos/<id>/edit`.
- Events, issues and CUB rounds link through `calendar_promo_id`. The old `promo_id` columns and `calendar_promo_tracks` are kept but unused.
- `promos.ts`: launch-event rule. Once a promo is past Idea/Tabled/Cancelled/Complete and has a launch (or targeted) date, one "Sales event" is added on that date. It is created once (`launch_event_created`); while it exists its name and date follow the promo; deleting it never brings it back. A CUB round no longer changes a promo's stage: CUB is a stage people pick.
- Brain: `calendar-promo:<id>` note on every save.
- Backfill: the migration defines and runs `calendar_backfill_own_promos()`. For each Promo Analyzer promo the Calendar referenced (a track or an event/issue/CUB `promo_id`) it creates one calendar promo with what the Calendar showed (title, product, gurus, type, stage/launch/writers/notes from the track; no track = the brand's first stage) and sets `calendar_promo_id` on those rows. Analyzer promos never referenced are not copied; deleted ones are copied as deleted (still hidden). Promos that already had an event never get an automatic launch event. Idempotent (`legacy_promo_id`); test in `packages/db/src/calendar-promos.test.ts`.

## List view (calendar3)

`week.ts`: the "This week" strip on `/editorial`: Monday–Friday of the week (`?week=±N`), every event from its event date to its end date, ignoring the list filters, today's column highlighted. Card colors come from `eventTypeColor()` by event type. Below it: quick add, filters (search, events/issues, channel, event type, publication, stage, "Upcoming / active only", "Hide recurring events") and the list rows with publication and stage pills.
