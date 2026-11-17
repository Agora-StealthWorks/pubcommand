# Track Record (module `performance`)

Route `/performance`, finance brands only (the nav hides it elsewhere and `trackAccess()` refuses it).
Permissions: `performance.read` (view everything), `performance.write` (add/edit/close/import, archive, public links).

## Pieces
- **Portfolios and recommendations**: symbol, direction, asset type (stock, ETF, option by OCC symbol, other),
  entry/stop/target/exit, weight, notes. Manual add/edit/close, plus CSV import with a dry run (`planImport`).
- **One gain engine** (`gain.ts` `computeGain`): TODAY, PEAK, EXIT (frozen), NONE. Shorts invert. Market prices
  are split-only adjusted (`@pubcommand/market`); `splitFactor` converts them into the entry's basis. It is
  detected from the adjusted close on the entry date (`inferSplitFactor`) unless a person sets it. With no fresh
  quote the last stored quote, then a recorded price, is used and flagged stale (`*`).
- **Stats** (`stats.ts`): win rate, average/weighted/median gain, best/worst, holding period. Internal only.
- **Public-safe view** (`publicTrackRecord`): closed trades only by default, date order, honest stats over every
  closed trade, and no loser count, worst trade or loser list (the type cannot carry them). Served at
  `/p/track-record/<token>` when a portfolio's public link is on, and as a CSV export.
- **Call archive** (`archive.ts`): experts, categories, documented calls with backup files in Postgres bytes,
  gains from the same engine. Lists nothing until an expert is picked or a ticker searched.
- **Brain**: a weekly aggregate note per portfolio, `sourceRef trackrecord:<portfolioId>:<ISO week>`.

Numbers never come from the AI. Server code: `apps/web/src/features/trackrecord/`.
Quotes are cached per org in `track_quotes` (10 minutes); responses also use ChartBuilder's `market_cache`.

## Tests
`pnpm --filter @pubcommand/modules test`
