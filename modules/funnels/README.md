# Funnels

Route `/funnels`, per brand. Rebuilt to work like the old OxfordHub **Launch Funnels** app (PLF): same rules, same flows, same public layout. (Text-letter sites live in **Mini-Blog**: `modules/miniblog`, route `/mini-blog`.)

- **Launch funnels**: a **waitlist** page with a big countdown and the agenda before the start → day-by-day **modules** (video or text) with thumbnail navigation, resources and a timed call to action → a close page or redirect. **Evergreen** (pre-recorded) or **Live** (a module sends people to the livestream room while live, then becomes its replay page).
- **Microsites**: a block-built home page is the front door, with the modules and pages around it.

Permissions: `funnels.read` (see everything, stats, previews), `funnels.write` (build and edit), `funnels.publish` (publish/unpublish, opt-in exports, header code, delegates, delete). A per-funnel **delegate** may edit one funnel without `funnels.write`. This replaces the old app's "hub admins + Delegate rows" gate.

## Builder (grouped tabs, presets, advanced options)

**New funnel presets**: Live challenge · Evergreen launch · Docuseries (expiring episodes) · Microsite (`presets.ts`). A preset only fills starting values for existing settings; everything stays editable.

The builder's tabs are gathered into nine groups (each tab keeps its `?tab=` key, so links and saves land where they did; a group with several tabs shows them as a second row): **Setup & publish** (Setup, Publish) · **Design** · **Schedule & access** (Mode & schedule, Progression & messages) · **Modules** · **Pages** (Home page or Waitlist page, Pages & links, Hosts, Close page) · **Countdowns & bars** (episode page settings + deadline bar) · **Offer section** · **Forms, SMS & email** (SMS forms, Invites & reminders) · **Advanced** (Advanced, Delegates). A **Show advanced options** switch (remembered per browser) hides rarely used settings (calendar invite details, join early / today's session, lock-first-module, force-unlock, hide passed, build mode, page messages, bar spacing and dismiss, locked-box colours, what happens at zero). Hidden fields still submit, so saving never loses a value.

The tabs themselves: Setup (publish checklist, name, link, custom domain) · Mode & schedule (type, evergreen/live, add-to-calendar, between sessions, session-day countdown, "join today's session", join early, timing, close behaviour) · Progression & messages (A–D, lock the first module, email force-unlock, lock passed modules / hide them from the nav, release countdown, build mode, every page message) · Modules (list + editor: type, live session, video, unlocking, agenda box, CTA, SMS form, calendar buttons, resources) · Pages & links · Waitlist page / Home page (+ agenda settings) · Hosts · Deadline bar · Design · Close page · Invites & reminders · SMS forms · Advanced (code, favicon, unpublish/delete) · Delegates · Publish. The header has Stats, Preview, **Preview as of** (time travel as a first-time visitor), Duplicate and Publish. Old tab links (`?tab=branding`) still work. The funnel type is shown as “Launch funnel” or “Microsite”, never “waitlist”.

## Docuseries episode pages

A docuseries (the preset sets all of this up) is an evergreen, per-viewer funnel where each episode opens on its day and **expires** after its access window:

- **Access window**: Progression & messages → “Each module stays open for (hours)” (`Funnel.accessHours`, per-module override `FunnelDay.accessHours`). A module that has opened locks again as `expired` that many hours later (“Access expired” + the `lockedExpiredMsg`, with a Get full access button to `#offer`). Open time = the start (first module, or all-open funnels) or the module's scheduled unlock; watch % and link-key modules have no fixed open time and never expire; live modules never expire. The front door goes to the open episode, between episodes to the next one's countdown, and once every episode has expired the funnel is closed for that viewer. Tests: `docuseries.test.ts`.
- **Countdowns & bars tab**: countdown style **boxes or flip clock** (every countdown), what happens at zero (reload into the page / stay), countdown tile colours; the **locked video box** (minimal = headline + countdown, box/text colours; e.g. black with “Episode 2 starts in…”, title token `{day}`); **episode navigation**: thumbnail strip, or an **episode list beside the video** (stacks under it on phones) with a status line per episode (Access expired / Expires in 22 hrs 51 mins / Available in 2 days) and optional blurred locked thumbnails.
- **Deadline bar** additions: position **In the header** (logo · message + flip clock · button in one sticky bar; phones show the message, clock and button, without the logo) and target **When the episode on screen expires**. Buttons may point to `#offer`.
- **Offer section tab**: the home page block builder, saved as `Funnel.offerBlocks` and shown under every module (anchor `#offer`; turn it off per module with “Show the offer section under this module”). New block types (also on home pages): **Pricing** (1–3 packages: price, crossed-out price, badge, features, bonus value stack `Name | $value`, order link, highlight), **Testimonials** (quote, name, stars), **Logo strip**, **FAQ** (opens on click), **Episode grid** (every module as a card with an Unlock button). The Countdown block can count to the episode's expiry; Meet your hosts shows six, then **Load more**.
- **Locked teasers**: a module resource with the style “Locked teaser” shows a lock (e.g. Download transcript / audio / video) and links to `#offer` or a URL. Clicks on offer buttons, teasers and the episode grid count as the click kind `offer` (and as offer clicks in the parameter breakdown).

## Public URLs (org host, no sign-in)

`/l/<funnel>`, `/l/<funnel>/day-<n>`, `/l/<funnel>/p/<page>`. `middleware.ts` rewrites `/l/*` to `apps/web/src/app/sites/public/[slug]/l/…`. **Custom domains** come from Settings → Domains: a domain whose target is `/l/<funnel>` serves the front door at `/` and modules at `/day-<n>`; `publicBase` returns `""` for that host so every link stays on the domain.

Preview: `?preview=1` shows drafts; `&as_of=YYYY-MM-DDTHH:mm` (org time zone) time-travels; `&fresh=1` ignores the viewer cookie (as_of or fresh alone also start a preview for signed-in members). Previews never write cookies or stats, but they DO follow the close redirect and the live redirect, so "preview as of" shows the real behaviour.

## Pure code (this folder, unit tested)

- `state.ts`: the ONE state engine. Precedence per module: closed → live now → live upcoming (its own session time, even before the funnel start) → not started → progression lock → video/content → replay pending → coming soon. A live session that already happened opens whatever the funnel start says. Module 1 is never progression-locked unless `lockFirstModule`; live modules follow their session times. With `keyForceUnlock` (B and C) a module's `?k=` link also opens it early. With `lockPassedModules` (B, C and D) a module whose video is open locks again (reason `passed`, pointing at the newest open module) once a later non-live module's video is open; the front door then goes to that newest module, and the funnel's `hidePassedModules` drops passed modules from the navigation strip. `entryDecision` is the front door: closed → home (microsite) → live now → waitlist (unless a live session already happened) → live funnels pick a module by **between sessions** (hybrid / recent / next, calendar day in the org time zone) → module 1. `earlierPendingSession` drives "join today's session". Default live length 3 h. Tests: `state-parity.test.ts` (the old app's scenarios, written fresh), `funnels.test.ts`, `microsite.test.ts`.
- `viewer.ts`: one HMAC-signed cookie per funnel (`pcf_<id>`): visitor id, per-viewer start, watched %, key unlocks, tracked URL parameters. Key = `FUNNELS_COOKIE_SECRET`, else derived from `AUTH_SECRET`.
- `time.ts`: org time zone (`org_settings.timezone`, default America/New_York) ↔ UTC, DST-aware. The old app was Eastern only.
- `video.ts`: **the one place that knows providers**: Wistia (default), YouTube, Vidalytics. Parses links, ids and embed snippets (provider override), strict id patterns, embed/oEmbed addresses, allowed player hosts, progress source per provider. Tests: `video.test.ts`.
- `calendar.ts`: `.ics` + Google links, invite title/description tokens (`{agenda} {topics} {room_url} {page_url} {day} {title} {date} {time} {funnel}`), reminders (`parseReminders`), series invites.
- `links.ts`: resource / homework link lists (button, text link or locked teaser; new tab).
- `presets.ts`: new-funnel presets (type, mode and starting settings; the docuseries offer blocks and locked teasers). Tests: `docuseries-blocks.test.ts`.
- `layout-css.ts`: the public layout (one 960px column shared by header, nav and content; framed 16:9 video; prev/next rows; agenda list/cards; waitlist hero). `design.ts` colours it.
- `checks.ts` (publish checks, incl. text modules, CTA and calendar), `stats.ts` (`funnelReport`: pages, devices, clicks, daily), `traffic.ts` (bot flags, click kinds, devices), `deadline.ts`, `nav.ts`, `blocks.ts`, `emails.ts`, `sms.ts`, `code.ts`, `delegates.ts`.

## Tracking parameters

- **Set once per organization** at **Funnels → Settings** (`/funnels/settings`, `funnels.publish`; linked from the funnel list). Every funnel and microsite in the org, in every brand, inherits it. Stored in `funnels_settings` (one row per org). Each save is audited (`funnels.settings.updated`, target `funnels_settings`).
- **Tracked URL parameters**: a list of query parameter names (chips you add and remove). Until someone saves, it is `utm_source, utm_medium, utm_campaign, utm_content, utm_term`. Names are lowercase `a–z 0–9 _`, up to 40 characters, at most 20. Saving an empty list turns tracking off.
- **Attribution**: *first touch* (default) keeps the first set of values a visitor arrived with; *last touch* replaces it with the newest link that carries any tracked parameter. Sets are never mixed.
- **How it is captured**: the page's `/sync` call reads the tracked parameters from the address of the page it came from (its Referer), keeps them in the visitor's signed cookie (`p` in `pcf_<id>`, size-capped; older cookies without it still work) and stores them on every page view and click (`funnel_events.params`). The front door keeps them when it redirects to a module. Email opt-ins and SMS sign-ups store the visitor's values too (`params` on `funnel_optins` / `funnel_sms_optins`), merged with the form page's address. Values are trimmed and cut to 200 characters. Previews record nothing. Bot flagging is unchanged.
- **Stats**: the funnel's Stats page has **By URL parameter → Break down by** over the org's tracked parameters: per value, visitors, opt-ins, views, offer clicks (CTA, deadline bar, close page and home page buttons) and click rate (visitors who made an offer click ÷ visitors). Each visitor counts once, under their first or latest value (the org's attribution); visitors without it are "(none)". It follows the page's date range and bot filter.
- **Exports**: the email and SMS opt-in CSVs have one column per tracked parameter (plus any older key a row carries).
- Totals per tracked parameter value (visitors and opt-ins, never the visitors themselves) go to the Operations Brain with the rest of the funnel traffic (see Rules). Pure code: `tracking.ts` (key list, picking, first/last touch, cookie budget, CSV columns) and `paramBreakdown` in `stats.ts`. Tests: `tracking.test.ts`.

## Videos

- Wistia: oEmbed (no token) on save fills title, length and a 640×360 thumbnail whenever the video changes; a manual thumbnail always wins. If Wistia can't be reached the save still works and says so (retried after the response).
- YouTube: oEmbed title/thumbnail; `img.youtube.com` thumbnail fallback; progress via the IFrame Player API.
- Vidalytics: no public metadata, so title, length and thumbnail are set by hand. The player loads from `fast.vidalytics.com/embeds/<account>/<embed>/`; progress is read from the `<video>` it renders, else time on the page (the builder says so).
- Watch % from every provider goes through the same `/sync` route, which accepts it only for a module the state engine says is open. Locked modules never render any provider's id; a Wistia poster (no id in it) may still show on the nav tile, as in the old app.

## AI agents

Agents use the builder's ordinary tabs through the page tools (`open_page`, `submit_form`). The
Design, Home page and Offer section editors save structured data from the browser, so agents
edit those with `get_funnel_editor` (the current JSON, the choices and every block type),
`save_funnel_editor` (part `design`, `home` or `offer`) and `add_funnel_image` (an image from a
public https address). These go through `/agent-api/funnels/<id>`, which only accepts a valid
agent pass and calls the editors' own save actions, so permissions, validation, sanitizing and the
audit log are the same as for a person. See `docs/AI-AGENTS.md`.

## Rules worth keeping

- Rich text is sanitized on save and on render (`features/funnels/sanitize.ts`); calendar-button embeds (`sanitizeEmbed`) lose scripts, handlers and iframes. Images are Postgres `bytea` (`FunnelAsset`).
- Publishing is blocked by check errors; a published funnel stays live while you edit.
- Countdowns use the server clock (skew-corrected) and only reload when they run out on an open page, never twice in 15 s (`guardedReload`). Locked pages reload themselves when they unlock (`UnlockRefresh`).
- **Funnel traffic teaches the Operations Brain, in aggregate only.** Every night the Master Brain's Operations Brain gets per-funnel totals across all organizations: visitors, views, opt-ins and opt-in rate, offer clickers, device mix, reach per module / episode, and visitors and opt-ins per tracked parameter value (`brain-traffic.ts`, `docs/USAGE.md`). Bots are left out. No visitor ids, emails, IPs, page URLs or person-like parameter values are passed on. The brand Brain still only gets the funnel's structure and agenda (`funnel:<id>`), never traffic.
- Opt-in emails/phones are PII: only `funnels.publish` CSV exports carry them, each export audited.

## Beyond the old app

Microsites and the block home page, the Design tab, email opt-ins with invites and reminders (job `funnels.reminders`), SMS forms, Forms embeds, YouTube and Vidalytics videos, notes under a video, bot filtering, delegates per funnel.
