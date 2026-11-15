# Intel

Route: `/intel`. Permission: `intel.read`. Plan entitlement: `intel`.

This slice is in-memory and scoped by `organizationId`.

- Competitor list (`name`, `domain`).
- Ingested email (`subject`, `from`, `receivedAt`, `bodyExcerpt`). The full body is not stored.
- Historical-call lookup by `YYYY-MM-DD`. Matches return example rows only. Dates with examples: `2026-03-12`, `2026-06-04`.

Nothing is scraped. `extractEmailInsights` and `scrapeCompetitorPage` are stubs.

`apps/web/src/app/sites/org/[slug]/intel/page.tsx` calls `loadIntelScreen` for the signed-in organization. A `date` query returns example historical calls. The shared store seeds two sample competitors and one sample email the first time an organization opens it.
