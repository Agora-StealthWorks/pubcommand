# Intel (My captures)

The `intel` module is shown as **ISpy**: its main screens are the shared ISpy feed (see `modules/ispy/README.md`). This file covers **My captures**, the part that stays private to one brand: competitor mail and videos an organization uploads or syncs itself. Permissions `intel.read` (view) and `intel.write` (change). Plan entitlement `intel`. Data belongs to the current brand and never reaches other organizations.

## Screens
- **Inbox** (`/intel/captures`): competitor emails with filters (competitor, type, date range, search, and list / expert / topic), plus **Export CSV** of exactly what is filtered.
- **Email** (`/intel/emails/<id>`): sanitized HTML in a sandboxed iframe (remote images blocked unless turned on), plain text, links, the AI extraction, its list/experts/topics, the captured **landing page** (text only, "Fetch page" re-runs extraction with it), manual competitor assignment, raw `.eml` download, Send to Promo Analyzer.
- **Promo Radar** (`/intel/radar?week=YYYY-MM-DD`): one week grouped by competitor, promos merged across re-sends, new promos flagged, recurring angles, and an AI read when a key is set.
- **Videos** (`/intel/videos`, `/intel/videos/<id>`), the old VidRipper: paste a sales page, webinar replay, YouTube, Vimeo or Wistia link. A background capture finds the player on the page, downloads it (yt-dlp, max 480p), takes the transcript (platform captions first, else speech-to-text), keeps up to six small keyframes and the page text, then runs the same AI extraction as emails. The video file is deleted. Transcript download, re-capture, competitor assignment, Send transcript to Promo Analyzer.
- **Competitors**: name, brands/products, websites, sender addresses and domains, notes, tags; one-click competitor from an unmatched sender domain; CSV export per competitor.
- **Registry** (`/intel/experts`, `/intel/lists`, `/intel/topics`, `/intel/registry/<id>`): experts/gurus, sender lists/newsletters (with a category: free, paid, hotlist, marketing) and topics, with counts, filters, aliases, ignore, merge and "Rebuild links".
- **Add emails**: `.eml` / `.mbox` upload (up to 50 MB) or paste.
- **Gmail**: Google OAuth (read-only), Sync now, a Gmail search filter, Disconnect.
- **Settings**: weekly digest (Slack incoming webhook stored encrypted, and/or team emails), "send last week's now", and whether landing pages are fetched automatically.

## Code
- Pure, unit-tested (`intel.test.ts`, `capture.test.ts`):
  - `mime.ts`, `ingest.ts`, `match.ts`, `links.ts`, `extraction.ts` (email and video prompts), `radar.ts`, `gmail.ts` as before.
  - `url-guard.ts`: the SSRF guard (scheme, port, private names, every resolved address public incl. IPv4-in-IPv6) and a redirect loop that re-checks each hop.
  - `landing.ts`: landing-page parsing (title, description, h1–h3, text, links) and the prompt block.
  - `video.ts`: platform detection, embed discovery, captions to text, keyframe times, the speech-to-text clients (Whisper-compatible, Rev AI) and the capture pipeline with injected tools.
  - `registry.ts`: name keys, resolving names and senders to entries, merge plans.
  - `digest.ts`: the Slack/email/text digest. `csv.ts`: exports (formula-safe cells).
- Server side (`apps/web/src/features/intel/`): `server.ts` (store, match, extract, radar, Promo Analyzer), `gmail.ts`, `net.ts` (guarded HTTP with connect-time address checks), `landing.ts`, `registry.ts`, `video.ts` (queue, one capture at a time, extraction), `video-tools.ts` (yt-dlp/ffmpeg), `scheduled.ts` (shared by jobs and the cron route), `settings.ts`.
- Jobs (`apps/web/src/jobs/intel-*.ts`): `intel.gmail-sync` (every 3 h), `intel.radar` (Mon 6:10 ET), `intel.digest` (Mon 8:05 ET), `intel.video-capture` (every 5 min; a paste also starts the capture at once).
- Routes: `/api/intel/gmail/callback`; `/api/intel/cron?job=sync|radar|all` (kept for external schedulers, `Authorization: Bearer $INTEL_CRON_SECRET`); `/intel/export?kind=emails|videos&…` (CSV).

## Rules
- The AI never supplies facts. Prices are as the email, page or transcript states them; the landing page must be one of the parsed links.
- Everything fetched for a user (landing pages, video pages, media) passes the URL guard first; the HTTP client re-checks the address it actually connects to. yt-dlp gets only guarded URLs (its own follow-up requests to the platform CDN are outside our guard).
- Commercial emails teach the brand Brain (`intel-email:<id>`), videos (`intel-video:<id>`), the radar (`intel-radar:<brandId>:<week>`).
- Without `ANTHROPIC_API_KEY`, emails and videos are still stored, matched and linked, and the UI says why there is no extraction.
