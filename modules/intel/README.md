# Intel

Route: `/intel`. Permission: `intel.read`. Plan entitlement: `intel`.

This slice is in-memory and scoped by `organizationId`.

- Competitor list (`name`, `domain`).
- Ingested email (`subject`, `from`, `receivedAt`, `bodyExcerpt`). The full body is not stored.
- Historical-call lookup by `YYYY-MM-DD`. Matches return example rows only. Dates with examples: `2026-03-12`, `2026-06-04`.

Nothing is scraped. `extractEmailInsights` and `scrapeCompetitorPage` are stubs.

```ts
import { loadIntelScreen, renderIntelScreen } from "./index";

const screen = loadIntelScreen({ organizationId, callDate });
const html = renderIntelScreen(screen);
```

The organization shell still paints the Phase 1 placeholder at `/intel`. Mount `renderIntelScreen` there when the shell can take a module view. `loadIntelScreen` seeds two sample competitors and one sample email the first time an organization opens the shared store.
