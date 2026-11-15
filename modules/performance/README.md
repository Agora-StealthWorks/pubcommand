# Performance

Route: `/performance`. Plan entitlement: `performance`.

Permissions:

- `performance.read` — open the report
- `performance.write` — record entries and broker imports

The slice lists recommendations for one `organizationId`: symbol, direction, opened date, closed date, and a simple dollar P&L. A second table shows launch-funnel placeholders: visits, opt-ins, and revenue. Those funnel figures are not live tracking.

The organization host serves `/performance` from `apps/web/src/app/sites/org/[slug]/performance/page.tsx`. That page calls `performanceHome(organizationId)` and renders both tables. The shared module placeholder is left unchanged.

## Example seed

`home.ts` ships an example book for two organizations so scoping can be tested. `listRecommendations` and `listLaunchFunnel` return only rows stored for the id you pass. An organization with no stored rows gets that example book projected onto its own id from `performanceHome`. The projection is not written back, and it never includes another organization's symbols.

P&L is `(exit - entry) * quantity` for a long recommendation and `(entry - exit) * quantity` for a short one. An open recommendation has no closed date and no P&L yet.

## Broker imports

TODO: import fills from the organization's broker and upsert recommendations for that `organizationId` only. `importBrokerRecommendations` returns `not_implemented`. Do not merge books across organizations.

## Tests

```bash
pnpm --filter @pubcommand/modules test
```
