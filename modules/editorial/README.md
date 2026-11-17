# Marketing Calendar

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
