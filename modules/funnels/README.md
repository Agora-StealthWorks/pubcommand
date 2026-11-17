# Funnels

Route `/funnels`, per brand. (Text-letter sites moved out into their own app, **Mini-Blog**: `modules/miniblog`, route `/mini-blog`.)

- **Launch funnels** (`/funnels`): a product-launch video series. Waitlist page (big countdown, agenda, optional opt-in) → day-by-day video pages (thumbnail nav, notes, resources, timed CTA) → close/order page. Evergreen (pre-recorded) or Live (days send people to an external livestream room while live, then become replay pages).

Permissions: `funnels.read` (see everything and stats), `funnels.write` (build and edit), `funnels.publish` (publish/unpublish, go live, export opt-ins, delete).

## Microsites and design

- **Type** (`funnels.site_type`): `launch` (front door = waitlist, then day 1) or `microsite` (front door = a home page built from blocks; `entryDecision` returns `home` until the funnel closes). Switchable on Setup; switching to a microsite with an empty home page seeds `starterBlocks`.
- `blocks.ts`: the home page block model (11 types, per-block style). `normalizeBlocks` is the only way in (builder, save action, renderer). Text blocks are sanitized on save and render; Custom HTML only ever renders in a sandboxed iframe (`HtmlFrame`).
- `design.ts`: design tokens (header, page, content box, nav tiles, footer) and `designCss`, which writes only validated values (hex colours, clamped numbers, allow-listed choices, `cssUrl`-checked images) into the page's `<style>`. The old flat colour columns are kept in step on save.
- `nav.ts`: custom pages (`/l/<funnel>/p/<page>`), links and "coming soon" placeholders placed among the modules (`afterModule`, `sort`).
- `deadline.ts`: the deadline ribbon (close, which is per viewer on evergreen per-viewer funnels; start; or a set time; optional last-N-hours window).
- `calendar.ts`: `.ics` (`/l/<funnel>/ics?day=|block=`) and Google Calendar links, in the org time zone.
- Builder live preview: the Home page and Design tabs save an unsaved draft (`home_blocks_draft`, `design_draft`; `{}` = none) and show `/l/<funnel>?preview=1&draft=1` in an iframe. Only previewers ever see a draft.

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

## Added: invites, SMS forms, delegates, code, bot filtering

- **Rich text** everywhere uses the shared WYSIWYG editor (`apps/web/src/components/rich-text-editor/`, TipTap). Its sanitizer (`sanitize.ts` there) is what `features/funnels/sanitize.ts` runs on save and render: alignment, colours, highlights, image wrap/width classes, and embeds from YouTube/Vimeo/Wistia/Loom only.
- **Deadline bar** (`deadline.ts`): per page kind (home, waitlist, day, custom; never the close page), optional button (URL or `module:<n>`), visitor dismiss remembered in sessionStorage per deadline.
- **Favicon, header/footer code** (Advanced tab, `funnels.publish` only, audited). `code.ts` moves `<meta>`/`<link>` into the head; code never runs in previews.
- **Invites & reminders** (`emails.ts`, `features/funnels/emails.ts`, job `funnels.reminders` every 5 min): confirmation after an email opt-in, reminders N minutes before each live session (or the fixed start). Sends are claimed under a unique key (`funnel_email_sends`), unsubscribed opt-ins are skipped, every email has a signed unsubscribe link (`/l/<funnel>/unsubscribe`, GET asks, POST unsubscribes). Without `RESEND_API_KEY` sends are recorded as "logged".
- **SMS forms** (`sms.ts`, `funnel_sms_forms`, `funnel_sms_optins`): phone + consent with the exact text stored; placed on the waitlist, an Opt-in home block, under a day's video or under a custom page. Posted to `/l/<funnel>/sms`. No SMS is sent (no provider).
- **Delegates** (`delegates.ts`, `funnel_delegates`): a member may read and edit one funnel without `funnels.write`; never publish, export, code, delegates or delete.
- **Bot filtering** (`traffic.ts`, `datacenter-ranges.ts`): views and clicks are stored with `bot_reason` (user_agent | datacenter | webdriver); stats leave them out unless `?bots=1`.
