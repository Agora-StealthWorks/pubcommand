# Calendar

Module id and route stay `editorial` / `/editorial`. One calendar per brand: live events, editorial issues, send stats, What's Working and the CUB Collector.

| | |
| --- | --- |
| Permissions | `editorial.read` (see everything), `editorial.write` (add, edit, import, CUB rounds) |
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
- Promos: events, issues and CUB rounds link to Promo Analyzer promos (`promo_id`); a CUB round moves the promo to the CUB stage (`calendar_promo_tracks`) and stores the draft as a `cub-draft` PromoFile.
