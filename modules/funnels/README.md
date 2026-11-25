# Funnels

Route `/funnels`, per brand. Rebuilt to work like the old OxfordHub **Launch Funnels** app (PLF): same rules, same flows, same public layout. (Text-letter sites live in **Mini-Blog**: `modules/miniblog`, route `/mini-blog`.)

- **Launch funnels**: a **waitlist** page with a big countdown and the agenda before the start → day-by-day **modules** (video or text) with thumbnail navigation, resources and a timed call to action → a close page or redirect. **Evergreen** (pre-recorded) or **Live** (a module sends people to the livestream room while live, then becomes its replay page).
- **Microsites**: a block-built home page is the front door, with the modules and pages around it.

Permissions: `funnels.read` (see everything, stats, previews), `funnels.write` (build and edit), `funnels.publish` (publish/unpublish, opt-in exports, header code, delegates, delete). A per-funnel **delegate** may edit one funnel without `funnels.write`. This replaces the old app's "hub admins + Delegate rows" gate.

## Builder tabs (grouped like the old editor)

Setup (publish checklist, name, link, custom domain) · Mode & schedule (type, evergreen/live, add-to-calendar, between sessions, session-day countdown, "join today's session", join early, timing, close behaviour) · Progression & messages (A–D, lock the first module, email force-unlock, lock passed modules / hide them from the nav, release countdown, build mode, every page message) · Modules (list + editor: type, live session, video, unlocking, agenda box, CTA, SMS form, calendar buttons, resources) · Pages & links · Waitlist page / Home page (+ agenda settings) · Hosts · Deadline bar · Design · Close page · Invites & reminders · SMS forms · Advanced (code, favicon, unpublish/delete) · Delegates · Publish. The header has Stats, Preview, **Preview as of** (time travel as a first-time visitor), Duplicate and Publish. Old tab links (`?tab=branding`) still work. The funnel type is shown as “Launch funnel” or “Microsite”, never “waitlist”.

## Public URLs (org host, no sign-in)

`/l/<funnel>`, `/l/<funnel>/day-<n>`, `/l/<funnel>/p/<page>`. `middleware.ts` rewrites `/l/*` to `apps/web/src/app/sites/public/[slug]/l/…`. **Custom domains** come from Settings → Domains: a domain whose target is `/l/<funnel>` serves the front door at `/` and modules at `/day-<n>`; `publicBase` returns `""` for that host so every link stays on the domain.

Preview: `?preview=1` shows drafts; `&as_of=YYYY-MM-DDTHH:mm` (org time zone) time-travels; `&fresh=1` ignores the viewer cookie (as_of or fresh alone also start a preview for signed-in members). Previews never write cookies or stats, but they DO follow the close redirect and the live redirect, so "preview as of" shows the real behaviour.

## Pure code (this folder, unit tested)

- `state.ts`: the ONE state engine. Precedence per module: closed → live now → live upcoming (its own session time, even before the funnel start) → not started → progression lock → video/content → replay pending → coming soon. A live session that already happened opens whatever the funnel start says. Module 1 is never progression-locked unless `lockFirstModule`; live modules follow their session times. With `keyForceUnlock` (B and C) a module's `?k=` link also opens it early. With `lockPassedModules` (B, C and D) a module whose video is open locks again (reason `passed`, pointing at the newest open module) once a later non-live module's video is open; the front door then goes to that newest module, and the funnel's `hidePassedModules` drops passed modules from the navigation strip. `entryDecision` is the front door: closed → home (microsite) → live now → waitlist (unless a live session already happened) → live funnels pick a module by **between sessions** (hybrid / recent / next, calendar day in the org time zone) → module 1. `earlierPendingSession` drives "join today's session". Default live length 3 h. Tests: `state-parity.test.ts` (the old app's scenarios, written fresh), `funnels.test.ts`, `microsite.test.ts`.
- `viewer.ts`: one HMAC-signed cookie per funnel (`pcf_<id>`): visitor id, per-viewer start, watched %, key unlocks. Key = `FUNNELS_COOKIE_SECRET`, else derived from `AUTH_SECRET`.
- `time.ts`: org time zone (`org_settings.timezone`, default America/New_York) ↔ UTC, DST-aware. The old app was Eastern only.
- `video.ts`: **the one place that knows providers**: Wistia (default), YouTube, Vidalytics. Parses links, ids and embed snippets (provider override), strict id patterns, embed/oEmbed addresses, allowed player hosts, progress source per provider. Tests: `video.test.ts`.
- `calendar.ts`: `.ics` + Google links, invite title/description tokens (`{agenda} {topics} {room_url} {page_url} {day} {title} {date} {time} {funnel}`), reminders (`parseReminders`), series invites.
- `links.ts`: resource / homework link lists (button or text link, new tab).
- `layout-css.ts`: the public layout (one 960px column shared by header, nav and content; framed 16:9 video; prev/next rows; agenda list/cards; waitlist hero). `design.ts` colours it.
- `checks.ts` (publish checks, incl. text modules, CTA and calendar), `stats.ts` (`funnelReport`: pages, devices, clicks, daily), `traffic.ts` (bot flags, click kinds, devices), `deadline.ts`, `nav.ts`, `blocks.ts`, `emails.ts`, `sms.ts`, `code.ts`, `delegates.ts`.

## Videos

- Wistia: oEmbed (no token) on save fills title, length and a 640×360 thumbnail whenever the video changes; a manual thumbnail always wins. If Wistia can't be reached the save still works and says so (retried after the response).
- YouTube: oEmbed title/thumbnail; `img.youtube.com` thumbnail fallback; progress via the IFrame Player API.
- Vidalytics: no public metadata, so title, length and thumbnail are set by hand. The player loads from `fast.vidalytics.com/embeds/<account>/<embed>/`; progress is read from the `<video>` it renders, else time on the page (the builder says so).
- Watch % from every provider goes through the same `/sync` route, which accepts it only for a module the state engine says is open. Locked modules never render any provider's id; a Wistia poster (no id in it) may still show on the nav tile, as in the old app.

## Rules worth keeping

- Rich text is sanitized on save and on render (`features/funnels/sanitize.ts`); calendar-button embeds (`sanitizeEmbed`) lose scripts, handlers and iframes. Images are Postgres `bytea` (`FunnelAsset`).
- Publishing is blocked by check errors; a published funnel stays live while you edit.
- Countdowns use the server clock (skew-corrected) and only reload when they run out on an open page, never twice in 15 s (`guardedReload`). Locked pages reload themselves when they unlock (`UnlockRefresh`).
- **No Brain learning from funnel traffic.** The brand Brain only gets the funnel's structure and agenda (`funnel:<id>`), never views, watch %, clicks or opt-ins.
- Opt-in emails/phones are PII: only `funnels.publish` CSV exports carry them, each export audited.

## Beyond the old app

Microsites and the block home page, the Design tab, email opt-ins with invites and reminders (job `funnels.reminders`), SMS forms, Forms embeds, YouTube and Vidalytics videos, notes under a video, bot filtering, delegates per funnel.
