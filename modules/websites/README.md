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

Nothing about publications is copied. Posts (`web_posts.publication_id`) and products (`web_products.publication_ids`) hold `calendar_publications` ids. Free vs paid uses the Publication Setup funnel rule (`funnelGroup()`: tier "Free / lead gen", or the legacy type "Free newsletter", = free). Publication logos, editors, bios and photos are read from Publication Setup and served by the site's own routes. Editor emails are never shown.

**Lists are grouped and ordered by the brand's publication categories** (Publication Setup → Categories): category order, then the publication's order, then name; uncategorized publications last (`modules/pubsetup/categories.ts`). The internal funnel tier and the old Type are never shown on any public page.

### Publication pages (`features/websites/publications-view.tsx`)

Modelled on how publishers present their lineup (a dark masthead with category jump links, then one section per category of cards with logo, name, editors, short description, frequency/price and a clear "Learn more" / "Sign up free"; each publication on its own page, never a popup):

- `/publications` (all), `/research` (paid), `/newsletters` (free): `PublicationsList`, grouped by category, with a free sign-up band.
- `/research/<pub>`, `/newsletters/<pub>`: `PublicationProfile`: hero (logo, name, tagline, editors with photos, frequency/category chips) with a join card (free → sign-up form; paid → the product's offer link, else the publication's sign-up/order page; members who own it → their members area); What you get (deliverables); About (long description); Pricing (offers, retail and lifetime price; never the typical sale price or pricing notes); What readers say (approved testimonials for the publication from the Testimonials app); FAQ (Publication Setup → "Questions and answers"); latest 4 issues with "All issues" (`?page=1` = the paginated archive); editor sidebar linking to `/editors#<slug>`; closing join band. Every section hides when Publication Setup has no data for it. `/publications/<pub>` redirects to the right one.

## Running the site as its own app (FreeMarketSociety.org)

FreeMarketSociety.org runs as a separate Next.js app (its own GitHub repo and Railway project) with no database. PubCommand stays the admin; the site reads everything through the **Website API**:

- Site settings → **Site address** (`web_sites.public_url`): sign-in emails link there, and publish refreshes are sent there.
- Site settings → **Make API key**: `pcw_<orgIdHex>_<siteIdHex>_<secret>`; only its SHA-256 and a short fingerprint are stored, the key is shown once. Replacing it stops the old one.
- `GET/POST /api/websites/v1/…` (`app/api/websites/v1/[...path]/route.ts`), `Authorization: Bearer <key>`, reader session in `x-member-session`:
  `site` · `posts?publication=&publications=&term=&type=&access=&featured=1&exclude=&take=&skip=` · `posts/<slug>` (full text or teaser + decision) · `terms/<category|tag>/<slug>` · `me` · `testimonials?publication=<id>&take=` · `media/<id>`, `logo?bg=`, `pub-logo/<id>?bg=`, `editor-photo/<id>` · POST `subscribe`, `auth/password`, `auth/link`, `auth/verify`, `auth/set-password`, `auth/sign-out`.
- Every save that changes the public site (`refreshPublic` in `actions.ts`) also POSTs `<site address>/api/revalidate` after the response, signed with `x-pubcommand-signature` = HMAC-SHA256(body) using the webhook secret shown with the key (derived from `AUTH_SECRET`, the site id and the key, so it changes with the key).

The `/w/<site>` pages below keep working as a preview of the same content.

### API contract change (2026-11-22): members log in with a password

Emailed links are no longer a way to log in. They only set or reset a password.

| Call | Now |
| --- | --- |
| `POST auth/password` `{ email, password, ip? }` | **The login.** `{ session, maxAge }`, or 401 `{ error: "invalid" }` (same answer for unknown email, no password yet, wrong password), 429 `{ error: "limited" }` (10 failures per 15 min per email and per IP). |
| `POST auth/link` `{ email, returnTo? }` | **Set/reset-password link** ("Forgot your password, or never set one?"). Always `{ ok: true }`. Emails "Set your password for <site>" from the site's name, linking to `<site address>/sign-in/verify?token=…&next=…`. |
| `POST auth/verify` `{ token }` | Redeems that link once: `{ session, maxAge, mustSetPassword, purpose: "set-password" }`. The session is short (60 min) and **reads as signed out** (members-only posts stay locked) until a password is set. |
| `POST auth/set-password` `{ password, currentPassword? }` + `x-member-session` | Sets or changes the password. `currentPassword` is required unless the session came from a link in the last 30 minutes (once). Returns `{ ok: true, maxAge }`: extend the session cookie to `maxAge`. Other sessions of the member are signed out. 400 `{ error }` is a readable message. |
| `GET me` | Adds `mustSetPassword` (true while the member has no password). |
| `GET site` | Publications are in category order and each has `category: { id, name, order } \| null`, `pricing: { retail, lifetime, offers }` and `faq: [{ question, answer }]`. Adds `categories: [{ id, name, order }]`. `pubType` and `tier` are internal-only classifications and are **not sent** (removed 2026-11-22); use `free` for free vs paid and `description` for the line under a publication's name. |
| `GET testimonials?publication=<id>` | New: approved testimonials (name, location, quote, result, date, rating, disclosure). |

**What the separate FreeMarketSociety.org app must change:**

1. Login screen: email + password form posting to `auth/password`. Remove "Email me a sign-in link" as a way to log in.
2. Add "Forgot your password, or never set one?" → email form → `auth/link` → "Check your email".
3. `/sign-in/verify?token=` route: call `auth/verify`, store the session (for `maxAge`), then **always go to a set-password screen** (new password + confirm → `auth/set-password`, then extend the cookie to the returned `maxAge` and go to `next`).
4. Members area: if `me.member.mustSetPassword`, redirect every members page to the set-password screen.
5. Account page: "Change password" (current + new + confirm → `auth/set-password` with `currentPassword`).
6. Publications list: group by `category` in the order sent (uncategorized last); use `free` for free vs paid (`tier`/`pubType` are no longer sent). Build publication pages from `pricing`, `faq`, `deliverables`, editors and `testimonials?publication=`.

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
| `/publications`, `/publications/<pub>` | All publications by category; the short link redirects to the publication's page |
| `/sign-in` (+ `/submit` password login, `/link` set-password email, `/verify`), `/sign-out` | Member login (email + password); `?forgot=1` emails a set-password link |
| `/my`, `/my/research`, `/my/alerts`, `/my/account` (+ `/password`), `/my/<pub>` | Members area (Account has Change password) |
| `/my/set-password` (+ `/submit`) | Where a set-password link lands; every members page sends a member without a password here |
| `/subscribe` (POST) | Free sign-up (one or more newsletters); honeypot + per-IP limit |
| `/media/<id>`, `/logo`, `/pub-logo/<id>`, `/editor-photo/<id>` | Images |

Post slugs cannot take these first segments, nor the public prefixes `f p l b t w embed` (`RESERVED_SLUGS`).

## Members and access

- Website members are readers, **not** staff users (`web_members`, one per site + email). They **log in with email + password** (`passwordSignIn`: bcrypt, rate limited, one answer for every failure). An emailed one-time link (30 min, hash stored) only sets or resets the password: redeeming it opens a short "link" session (`web_member_sessions.method = 'link'`) and goes straight to `/my/set-password`. A member without a password reads as signed out (`viewerFor`) and every members page redirects to set one (`membersGate`), so a link never gives content access by itself. The session is an httpOnly per-site cookie `pc_wm_<site>` (60 days once a password is set, hash stored). Changing a password needs the current one unless the session came from a link in the last 30 minutes; other sessions are signed out.
- Reader emails (`setPasswordEmail`) name only the site and are sent from the site's name at the configured address (`senderWithName(site.name, EMAIL_FROM)`).
- Admins (`websites.members`): Members → a member → "Send set-password link", or "Set a password for them" (audited `websites.member.password_set`; signs the member out everywhere; nothing is emailed).
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
- Fonts: Oswald, Bodoni Moda, Inter via `next/font/local` in the `w/[siteSlug]` layout, from files committed in `features/websites/fonts/` (latin subset, from `@fontsource-variable/*` 5.3.0; all SIL Open Font License 1.1, license files next to the fonts). Builds never download fonts.
- Public pages never name the platform: no platform title/favicon, reader emails from the site's name, staff preview bar only for signed-in staff.
