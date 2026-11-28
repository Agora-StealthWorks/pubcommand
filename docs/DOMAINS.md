# Custom domains and public links

An organization can point its own domains at its public pages in **Settings → Domains**: a form (`/f/<form>`), a funnel (`/l/<funnel>`), a Mini-Blog (`/b/<site>`, or the old `/t/<site>`) or a website (`/w/<site>`, or its members area `/w/<site>/my`). Each domain has one target page. Domains are stored in `custom_domains` (`packages/db/prisma/schema/domains.prisma`).

## Serving

The middleware looks the request host up (`apps/web/src/features/domains/resolve.ts`, cached for a minute) and rewrites it onto the organization's public pages (`decideCustomHost` in `modules/settings/domains/routing.ts`):

- `/` is the target page; a path under it is joined onto the target (`/morning-note` on a `/b/digest` domain is `/b/digest/morning-note`).
- A path that already starts with a public prefix (`/b/…`, `/f/…`, `/embed/…`…) is served as that public page, which is how logos, form submits and embeds work on the domain.
- App, admin, auth and API paths are refused.

## Links always use the domain

Every link PubCommand shows for a public page uses the page's custom domain when one is set up and **Active** (DNS verified), and the organization's PubCommand address only when there is none. That covers, in the admin and anywhere links are copied:

- Mini-Blog: Preview buttons, "Public link" boxes, post links, the link written on each post's Calendar issue (also for posts AI agents publish).
- Funnels: the header link and Preview, **Preview as of**, the Day 1 and unlock-key links, module and page previews, the funnel list's Preview.
- Websites: "View site", "Members area", post and page View/Preview links, the homepage Preview, the site list.
- Forms: the share link, the embed code and the public results link.
- The platform audit tools' `public_url`.

`customDomainUrl` (`modules/settings/domains/links.ts`, tested with the router so every URL it builds is served as that page) maps a public path to its domain: the most specific target wins, `/b`↔`/t` and `/f`↔`/embed` count as the same page, and a path whose first segment would be read as a public prefix keeps its full public path. Server code calls `publicLinker` (`apps/web/src/features/domains/public-links.ts`) for an organization and gets `url(path)` and `preview(path, scope)`. A domain that is still pending DNS is not used, so links never point at an address that does not load yet.

## Preview links work on the domain

Drafts, scheduled posts and offline pages are only shown to people allowed to preview them. On the PubCommand host the sign-in cookie proves that; on a custom domain it is never sent. So every Preview link carries a signed token (`pv`, `apps/web/src/lib/preview-token.ts`): an HMAC with `AUTH_SECRET` of the organization, the one thing it previews (`miniblog:<site>`, `funnel:<funnel>`, `website:<site>`) and an expiry about a week out. A valid token grants previewing that one Mini-Blog, funnel or website, nothing else: it does not sign anyone in and cannot be reused for another page. A link without a token, with a changed token or past its expiry previews nothing (an offline page is "not found"). Funnel and Mini-Blog previews keep the token on the links inside the preview, so moving between pages stays in preview.
