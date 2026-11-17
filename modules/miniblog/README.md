# Mini-Blog

Route `/mini-blog`. Formerly "text-letter sites" inside Funnels; now its own app.

A Mini-Blog is a small public site per brand: the latest post, an archive, one page per post, and a subscribe page that captures a mobile number with the exact SMS consent text. **No SMS is sent** (no provider yet); opt-ins are exported as CSV.

Permissions: `miniblog.read` (see everything), `miniblog.write` (create sites, write posts), `miniblog.publish` (publish/unpublish posts, go live, delete a site, export opt-ins). Entitlement `miniblog`.

## Public URLs (org host, no sign-in)

- `/b/<site>`, `/b/<site>/<post>`, `/b/<site>/subscribe` are canonical. Every link PubCommand builds uses `/b/`.
- `/t/<site>/…` (the old text-letter path) serves the same pages, so links already sent out keep working.
- `middleware.ts` rewrites both to `apps/web/src/app/sites/public/[slug]/{b,t}/…`; the `t/` route files only re-export the `b/` ones.
- Links inside the pages are built from the browser path (`publicBaseFor` in `paths.ts`), so a custom domain that maps its root to `/b/<site>` (Settings → Domains, group "Mini-Blogs") works unchanged.

Admin preview: `?preview=1` shows drafts and scheduled posts. Previews never record views or opt-ins.

## Pure code (this folder, unit tested in `miniblog.test.ts`)

- `sms.ts`: E.164 phone validation, consent text, `captureOptin` (refuses a form that showed stale consent text), compliance lines.
- `site.ts`: slugs, go-live checks, colours, CSV, excerpts, `postState`, the Brain note.
- `paths.ts`: canonical `/b/` paths and the link base for `/b/`, `/t/` and custom domains.
- `time.ts`: org time zone ↔ UTC (a copy of the Funnels helper so the apps stay independent).

## Data

Tables `text_sites`, `text_posts`, `text_optins`, `text_views` (models in `packages/db/prisma/schema/miniblog.prisma`). The names are kept from before the rename so no data moved. Uploaded logos still live in `funnel_assets` (owner = site id).

## Rules worth keeping

- Rich text is sanitized on save and again on render (`features/miniblog/sanitize.ts`).
- Phone numbers are PII: only the `miniblog.publish` CSV export carries them, and each export is audited. Elsewhere they are masked.
- The Brain gets post text and aggregates under `sourceRef` `tletter-post:<id>` (kept from before the rename, so existing notes update instead of duplicating).
- A post on a Mini-Blog with a Marketing Calendar code creates one calendar issue on every publish/save, including scheduled posts, idempotent through `text_posts.calendar_issue_id`.

## Link-click tracking and the calendar job

- On save every http(s) link in a post (and its button) becomes a `text_links` row (`links.ts`). Public pages point links at `/b/<site>/go/<id>`, which records a `text_link_clicks` row (flagged when it looks automated) and 302s to the URL stored on that row only: no open redirect. Counts show per post in the editor and the posts table.
- Job `miniblog.calendar-status` (every 5 min) moves a post's Marketing Calendar issue from Scheduled to Sent once the post is live.
- Post images upload into `funnel_assets` (kind `post_image`) and are served at `/b/<site>/asset/<id>`.
