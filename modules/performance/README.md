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
- **Legs and fills** (`legs.ts`, Portfolio Manager): a position can be tracked by fills. Each leg (stock, or each
  option of a spread) has OPEN fills (scale in) and CLOSE fills (scale out). Average cost; realized P&L at average
  cost; unrealized marks the open quantity; return = (realized + unrealized) / capital at risk (net debit or credit
  for a spread). A leg closed out completely stays closed; over-closing and closing before opening are refused.
  `computeGain` takes `legs` and delegates, so stats, exports and the public view use the same number. The position
  row caches entry/exit/status/realized from the fills (`fills.ts syncPositionFromFills`).
- **AI read of call backups** (`backup-read.ts`, `image-pdf.ts`): screenshots (PNG/JPEG, wrapped into a one-page
  PDF), PDFs, Word files and transcripts (.txt/.vtt/.srt) are transcribed and the call's fields proposed
  (ticker, direction, date, entry, target, exit, quote). Video/audio are not transcribed; attach a transcript. The
  proposal is stored, never applied: a person opens the form with it filled in and saves. Prices read from a
  document are flagged (`priceCheck`) until a person changes them or marks them checked. AI usage is logged.
- **Embeddable widget** (`widget.ts`): `/p/track-record/widget/<token>` (iframe, posts its height) and
  `/p/track-record/widget/<token>/data` (JSON, CORS). Built only from `publicTrackRecord` plus an allow-list;
  closed trades by default; per-portfolio token that can be rotated or turned off.
- **Weekly report** (`report.ts`): Friday 4:30 pm ET email per brand to the team members picked on
  `/performance/reports` (one email each), auto-send or draft-and-send. No people, notes, loser count or worst trade.
- **Google Sheets / Airtable** (`sources.ts`): connect a sheet (link-shared CSV, or the person's API key) or an
  Airtable table (the person's PAT). Tokens are AES-256-GCM encrypted with a key from `AUTH_SECRET`. The same
  dry-run planner (`planImportTable`) runs first; the hourly re-sync only creates and closes, never deletes.
- **Jobs**: `performance.price-refresh` (quotes, peaks, splits, weekdays every 30 min in market hours),
  `performance.weekly-summary` (Brain note, Fridays), `performance.weekly-report` (email, Fridays),
  `performance.import-sync` (hourly).
- **Brain**: a weekly aggregate note per portfolio, `sourceRef trackrecord:<portfolioId>:<ISO week>`.

Numbers never come from the AI. Server code: `apps/web/src/features/trackrecord/`.
Quotes are cached per org in `track_quotes` (10 minutes); responses also use ChartBuilder's `market_cache`.

## Tests
`pnpm --filter @pubcommand/modules test`
