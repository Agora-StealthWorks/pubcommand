# Mini-Blog

Route `/mini-blog`. Formerly "text-letter sites" inside Funnels; now its own app.

A Mini-Blog (a "T-Letter") is a small public site per brand: the latest post, an archive, one page per post, and a subscribe page for its **medium**. It carries everything the OxfordHub T-Letter site (`stephenpriorhub/mta-sms`) had, plus themes, mediums and ad zones. **Nothing is sent** (no SMS or email provider yet); opt-ins are exported as CSV.

Permissions: `miniblog.read` (see everything), `miniblog.write` (create sites, write posts), `miniblog.publish` (publish/unpublish posts), `miniblog.manage` (go live, delete/restore a site, ad codes, app settings, export opt-ins). Entitlement `miniblog`.

## Mediums (`mediums.ts`)

Mini-Blog → App settings (`/mini-blog/settings`, `miniblog.manage`) holds the organization's list (`miniblog_settings.mediums`): Email, SMS, Push Notification until an admin saves one. A new Mini-Blog asks for its medium (and Calendar publication). The medium picks the subscribe form (`subscribeKind`: "sms"/"text" → mobile number with carrier consent, "email"/"newsletter" → email address, anything else → no form, `/subscribe` 404s), the go-live checks, and is the **issue type** of its posts' Calendar issues.

## Themes (`themes.ts`) and the shared renderer

T-Letter (new Mini-Blogs), Classic (every Mini-Blog made before themes), Newsprint, Minimal, Midnight. Settings → Look shows each theme as a preview, then header color, button color and logo size with a live preview (`features/miniblog/look-editor.tsx`). `features/miniblog/article.tsx` renders the page parts from CSS variables; the public pages, the Look preview and the post editor's live preview all use it, so previews match. "Use the brand look" still overrides colors and logo; the theme keeps the page style. Logos are centered.

## Posts (T-Letter fields)

Title, link name, publish time, internal category (the Mini-Blog's list, filterable) and tickers (copied to the Calendar issue), body, top ad and content ad, "Action to take" with a secondary line and button. The editor (`features/miniblog/post-editor.tsx`) shows a live preview beside the form. Deleted posts go to the Recycle bin tab; deleted Mini-Blogs to the Recycle bin on the list page.

## Ad zones (`ads.ts`)

Ads tab (`miniblog.manage`): ad network codes per Mini-Blog (`text_sites.ad_codes`: AdSense, Taboola, Kevel, custom HTML). Each post picks what fills its **top ad** (above the card) and its **content ad** (where the writer put `[content ad]`, inserted with the editor's "+ Content ad" button): no ad, a text ad (text + tracked link, the T-Letter top ad) or one of the codes. Codes are raw HTML/script: they run only on public pages (the previews show a placeholder), only admins edit them, and every change is audited. Removing a code sets posts that used it back to no ad.

## Stat engine (`stats.ts`, `features/miniblog/stats.ts`)

The T-Letter engine: a first-party view pixel (`/b/<site>/px?p=<post>`) and the `/go/` click redirect both carry an anonymous cookie (`mb_vid`). Unique = distinct visitor ids (rows without one count singly). Per post: views, unique views, clicks, unique clickers, CTR (unique clickers ÷ unique views), and per link clicks/unique/CTR typed **Ad** (text ads), **CTA** (button) or **Content** (body). Bots, link scanners, data-center clicks and previews are left out. Shown on the Posts and Stats tabs, the post editor, and the Calendar (chip in the list and month views, full box on the issue page).

## Public URLs (org host, no sign-in)

- `/b/<site>`, `/b/<site>/<post>`, `/b/<site>/subscribe` are canonical. Every link PubCommand builds uses `/b/`.
- `/t/<site>/…` (the old text-letter path) serves the same pages, so links already sent out keep working.
- `middleware.ts` rewrites both to `apps/web/src/app/sites/public/[slug]/{b,t}/…`; the `t/` route files only re-export the `b/` ones.
- Links inside the pages are built from the browser path (`publicBaseFor` in `paths.ts`), so a custom domain that maps its root to `/b/<site>` (Settings → Domains, group "Mini-Blogs") works unchanged.

Admin preview: `?preview=1` shows drafts and scheduled posts. Previews never record views or opt-ins.

## Pure code (this folder, unit tested in `miniblog.test.ts`)

- `sms.ts`: E.164 phone validation, SMS and email consent text, `captureOptin` / `captureEmailOptin` (refuse a form that showed stale consent text), compliance lines.
- `themes.ts`, `ads.ts`, `mediums.ts`, `stats.ts`, `post-fields.ts`: see above (tests in `tletter.test.ts`).
- `site.ts`: slugs, go-live checks, colours, CSV, excerpts, `postState`, the Brain note.
- `paths.ts`: canonical `/b/` paths and the link base for `/b/`, `/t/` and custom domains.
- `time.ts`: org time zone ↔ UTC (a copy of the Funnels helper so the apps stay independent).

## Data

Tables `text_sites`, `text_posts`, `text_optins`, `text_views`, `text_links`, `text_link_clicks`, `miniblog_settings` (models in `packages/db/prisma/schema/miniblog.prisma`). The names are kept from before the rename so no data moved. Uploaded logos still live in `funnel_assets` (owner = site id).

## Rules worth keeping

- Rich text is sanitized on save and again on render (`features/miniblog/sanitize.ts`).
- Phone numbers are PII: only the `miniblog.publish` CSV export carries them, and each export is audited. Elsewhere they are masked.
- The Brain gets post text and aggregates under `sourceRef` `tletter-post:<id>` (kept from before the rename, so existing notes update instead of duplicating).
- A post on a Mini-Blog with a Calendar code is one Calendar issue from the moment it is created, on its publish date, with the medium as the issue type: Drafting (draft, or waiting for approval) → Scheduled → Sent. Every save updates it (idempotent through `text_posts.calendar_issue_id`); deleting the post removes the issue unless it was Sent; restoring puts it back.

## Link-click tracking and the calendar job

- On save every http(s) link in a post (and its button) becomes a `text_links` row (`links.ts`). Public pages point links at `/b/<site>/go/<id>`, which records a `text_link_clicks` row (flagged when it looks automated) and 302s to the URL stored on that row only: no open redirect. Counts show per post in the editor and the posts table.
- Job `miniblog.calendar-status` (every 5 min) moves a post's Calendar issue from Scheduled to Sent once the post is live.
- Post images upload into `funnel_assets` (kind `post_image`) and are served at `/b/<site>/asset/<id>`.
