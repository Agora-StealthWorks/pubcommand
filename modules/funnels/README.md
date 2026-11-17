# Funnels

Route `/funnels`, per brand. (Text-letter sites moved out into their own app, **Mini-Blog**: `modules/miniblog`, route `/mini-blog`.)

- **Launch funnels** (`/funnels`): a product-launch video series. Waitlist page (big countdown, agenda, optional opt-in) → day-by-day video pages (thumbnail nav, notes, resources, timed CTA) → close/order page. Evergreen (pre-recorded) or Live (days send people to an external livestream room while live, then become replay pages).

Permissions: `funnels.read` (see everything and stats), `funnels.write` (build and edit), `funnels.publish` (publish/unpublish, go live, export opt-ins, delete).

## Public URLs (org host, no sign-in)

`/l/<funnel>`, `/l/<funnel>/day-<n>`. `middleware.ts` rewrites `/l/*` to `apps/web/src/app/sites/public/[slug]/l/…`. Links on those pages are built from the browser path (`publicBase`), so a custom domain that maps its root to `/l/<slug>` works without changes here (the host check is `publicSiteMatches`).

Admin preview: `?preview=1` shows drafts; `&as_of=YYYY-MM-DDTHH:mm` (org time zone) time-travels; `&fresh=1` ignores the viewer cookie. Previews never write cookies or stats.

## Pure code (this folder, unit tested)

- `state.ts`: the ONE state engine. Precedence: closed → live now → not started → live upcoming → progression lock → video → replay pending → coming soon. `entryDecision` (the front door) uses it, and so does the sync route before accepting a watch %. Day 1 is never progression-locked; live days follow their session times.
- `viewer.ts`: one HMAC-signed cookie per funnel (`pcf_<id>`): visitor id, per-viewer start, watched %, URL-key unlocks. Key = `FUNNELS_COOKIE_SECRET`, else derived from `AUTH_SECRET`.
- `time.ts`: org time zone (`org_settings.timezone`) ↔ UTC, DST-aware.
- `sms.ts`: waitlist email validation.
- `video.ts` (Wistia/YouTube parsing, oEmbed), `checks.ts` (publish checks, slugs, CSV), `stats.ts` (aggregates and Brain notes).

## Rules worth keeping

- Locked days never render their video id (`publicDays` strips ids, automatic thumbnails and unlock keys before rendering).
- Rich text is sanitized on save and again on render (`features/funnels/sanitize.ts`).
- Opt-in emails/phones are PII: only the `funnels.publish` CSV exports carry them, and each export is audited. The Brain gets aggregates (`funnel:<id>`), never contact details.
