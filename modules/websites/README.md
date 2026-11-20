# Websites

Route `/websites` (module id and slug `websites`). A WordPress-style CMS for a brand's **public website** and its **members-only site**, run from inside PubCommand. Built first for FreeMarketSociety.org.

The sidebar shows the app's own pages under it while it is open (manifest `nav[1..]`): Posts, Add new post, Pages, Media, Categories & tags, Members, Products & access, Free sign-ups, Site settings. Sub-menus are generic: any app whose manifest lists more than one nav item gets them (`lib/apps.ts` `subnav`, rendered in `org-shell.tsx`).

## Permissions

| Key | Gives |
| --- | --- |
| `websites.read` | See sites, posts, pages, media |
| `websites.write` | Write and edit drafts, upload media, categories and tags. "Publish" becomes "Submit for review"; live posts are read-only. |
| `websites.publish` | Publish/schedule/unpublish, create sites, site settings (take live) |
| `websites.members` | Members, products & access, free sign-ups and the CSV export (reader emails are PII; every export is audited) |

Given to the `owner` and `admin` roles by migration `20261119120000_websites`; plans `pro`, `enterprise`, `internal`.

## Publications come from Publication Setup

Nothing about publications is copied. Posts (`web_posts.publication_id`) and products (`web_products.publication_ids`) hold `calendar_publications` ids. Free vs paid uses the Publication Setup funnel rule (`funnelGroup()`: type "Free newsletter" or tier "Free / lead gen" = free). Publication logos (dark-background slot), editors, bios and photos are read from Publication Setup and served by the site's own routes. Editor emails are never shown.

## Running the site as its own app (FreeMarketSociety.org)

FreeMarketSociety.org runs as a separate Next.js app (its own GitHub repo and Railway project) with no database. PubCommand stays the admin; the site reads everything through the **Website API**:

- Site settings → **Site address** (`web_sites.public_url`): sign-in emails link there, and publish refreshes are sent there.
- Site settings → **Make API key**: `pcw_<orgIdHex>_<siteIdHex>_<secret>`; only its SHA-256 and a short fingerprint are stored, the key is shown once. Replacing it stops the old one.
- `GET/POST /api/websites/v1/…` (`app/api/websites/v1/[...path]/route.ts`), `Authorization: Bearer <key>`, reader session in `x-member-session`:
  `site` · `posts?publication=&publications=&term=&type=&access=&featured=1&exclude=&take=&skip=` · `posts/<slug>` (full text or teaser + decision) · `terms/<category|tag>/<slug>` · `me` · `media/<id>`, `logo?bg=`, `pub-logo/<id>?bg=`, `editor-photo/<id>` · POST `subscribe`, `auth/link`, `auth/verify`, `auth/sign-out`.
- Every save that changes the public site (`refreshPublic` in `actions.ts`) also POSTs `<site address>/api/revalidate` after the response, signed with `x-pubcommand-signature` = HMAC-SHA256(body) using the webhook secret shown with the key (derived from `AUTH_SECRET`, the site id and the key, so it changes with the key).

The `/w/<site>` pages below keep working as a preview of the same content.

## Public URLs

On the org host: `/w/<site>/…` (middleware rewrites to `app/sites/public/[slug]/w/[siteSlug]/…`). On the site's own domain (Settings → Domains, provider "Websites") the root is the site, so URLs are clean (`freemarketsociety.org/my`). `LoadedSite.base` is the link prefix: `/w/<site>` on the org host or a domain pointing elsewhere (e.g. a members subdomain), `""` on a domain whose target is the site root.

| Path | Page |
| --- | --- |
| `/` | Home: featured post, latest, sign-up bar, picks, premium research, editors |
| `/<slug>` | Post or page. Locked posts show `teaserBlocks` blocks and a gate (sign in / sign up free / upgrade) |
| `/latest`, `/category/<slug>`, `/tag/<slug>` | Archives |
| `/newsletters`, `/newsletters/<pub>` | Free newsletters and their landing + archive (sign-up form) |
| `/research`, `/research/<pub>` | Paid publications, landing + archive; "See the offer" uses the product's offer link |
| `/editors` | Editors from Publication Setup |
| `/sign-in` (+ `/submit`, `/verify`), `/sign-out` | Member sign-in by emailed one-time link |
| `/my`, `/my/research`, `/my/alerts`, `/my/account`, `/my/<pub>` | Members area |
| `/subscribe` (POST) | Free sign-up (one or more newsletters); honeypot + per-IP limit |
| `/media/<id>`, `/logo`, `/pub-logo/<id>`, `/editor-photo/<id>` | Images |

Post slugs cannot take these first segments, nor the public prefixes `f p l b t w embed` (`RESERVED_SLUGS`).

## Members and access

- Website members are readers, **not** PubCommand users (`web_members`, one per site + email). They sign in with a one-time link (30 min, hash stored); the session is an httpOnly per-site cookie `pc_wm_<site>` (60 days, hash stored). Sign-in answers identically for unknown emails.
- A free sign-up creates a member (no paid access) and a `web_signups` row per newsletter.
- **Products** unlock publications (or everything, incl. future ones). **Entitlements** connect members to products: `active`, `past_due` (keeps access until its end date = grace) or `cancelled`, with optional start/end dates, source (`manual`, `comp`, `import`, `purchase`) and an order reference.
- `canRead(post, viewer)` (pure, `content.ts`) decides: `public` → everyone; `free` → any signed-in member; `members` → members whose products include the post's publication (or any paying member if the post has no publication). Staff signed in to PubCommand see everything (preview).
- Automatic excerpts of locked posts are made from the teaser only, so paid text never leaks into cards or meta tags.

Not built yet (next): billing/fulfillment sync of orders into entitlements, sending newsletters (sign-ups export as CSV), comments, search, RSS/sitemap.

## Data

`packages/db/prisma/schema/websites.prisma`: `web_sites`, `web_posts`, `web_terms`, `web_post_terms`, `web_assets` (media as bytes; SVG uploads are rasterized to PNG with resvg and never served as SVG), `web_products`, `web_members`, `web_entitlements`, `web_signups`, `web_member_tokens`, `web_member_sessions`. All tenant tables with RLS.

## Code

- Pure rules, tested in `websites.test.ts`: `content.ts` (slugs, statuses, access, teasers, menus, paths, CSV).
- Server: `apps/web/src/features/websites/` — `guard.ts`, `actions.ts`, `data.ts`, `media.ts`, `members.ts` (links, sessions), `public.ts` (site loader, per request), `public-routes.ts` (forms and images), `site-view.tsx` + `site.css` (public look, scoped under `.ws`, colors from the site theme), `editor.tsx` (post editor on the shared rich-text editor).
- Fonts: Oswald, Bodoni Moda, Inter via `next/font` (self-hosted) in the `w/[siteSlug]` layout.
