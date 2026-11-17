# Intel

Competitor intelligence: what competing publishers send and promote. Route `/intel`. Permissions `intel.read` (view) and `intel.write` (change). Plan entitlement `intel`. Data belongs to the current brand.

## Screens
- **Inbox** (`/intel`): competitor emails with filters (competitor, type, date range, search).
- **Email** (`/intel/emails/<id>`): sanitized HTML in a sandboxed iframe. Remote images are blocked unless you turn them on. Also a plain-text view, the email's links, the AI extraction, manual competitor assignment, a raw `.eml` download, and Send to Promo Analyzer.
- **Promo Radar** (`/intel/radar?week=YYYY-MM-DD`): one week's emails grouped by competitor, with promos merged across re-sends. Promos not seen in earlier weeks are flagged new, and recurring angles are listed. With an AI key it adds a written read.
- **Competitors**: publisher name, brands/products, websites, sender addresses and domains, notes, tags. Sender domains nobody claims yet can become a competitor in one click.
- **Add emails**: upload `.eml` or `.mbox` files (up to 50 MB), or paste either a full message source or a body plus sender fields.
- **Gmail**: connect an inbox with Google OAuth (read-only scope), Sync now, a Gmail search filter, and Disconnect.

## Code
- Pure, unit-tested code (`intel.test.ts`):
  - `mime.ts`: the .eml and mbox parser.
  - `ingest.ts`: uploads, pastes and dedupe keys.
  - `match.ts`: sender matching (exact address, then the most specific domain, then the website domain).
  - `links.ts`: tracker unwrapping and a landing-page guess. It never fetches anything.
  - `extraction.ts`: AI schema, prompt and clean-up.
  - `radar.ts`: weekly grouping, narrative and Brain notes.
  - `gmail.ts`: OAuth URL, signed state, AES-GCM token encryption and a Gmail REST client with injected fetch.
- Server side (`apps/web/src/features/intel/`):
  - `server.ts`: storing, matching, extraction, radar, and the Promo Analyzer hand-off.
  - `gmail.ts`: sync and tokens.
  - `sanitize.ts`: email HTML sanitizer, unit-tested.
- Routes:
  - `/api/intel/gmail/callback`: the single OAuth redirect, on the app host.
  - `/api/intel/cron?job=sync|radar|all`: requires `Authorization: Bearer $INTEL_CRON_SECRET`.

## Rules
- The AI never supplies facts. A price is recorded as the email states it, and the landing page must be one of the parsed links.
- Commercial sends (promo, renewal, upsell, event) teach the brand Brain with `sourceRef` `intel-email:<id>`. The weekly radar teaches it with `intel-radar:<brandId>:<week>`.
- Without `ANTHROPIC_API_KEY`, emails are still stored and matched, and the UI explains why there is no extraction.
- Without `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, the Gmail page shows setup steps and the redirect URL to register.
