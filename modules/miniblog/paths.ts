/**
 * Public URLs of a Mini-Blog on the org host.
 *
 * - `/b/<site>/…` is canonical: every link we build uses it.
 * - `/t/<site>/…` is the old text-letter path. It keeps serving the same pages
 *   so links already sent out by text never break.
 *
 * Links inside the public pages are relative to whichever prefix the visitor
 * used. On a custom domain that maps its root to `/b/<site>` (or `/t/<site>`)
 * the browser path has no prefix, so links start at "/".
 */
export const CANONICAL_PREFIX = "b";
export const MINIBLOG_PREFIXES = ["b", "t"] as const;
export type MiniBlogPrefix = (typeof MINIBLOG_PREFIXES)[number];

/** The canonical public path of a site or one of its pages: `/b/<site>` or `/b/<site>/<rest>`. */
export function miniBlogPath(siteSlug: string, rest = ""): string {
  const tail = rest.replace(/^\/+/, "");
  return `/${CANONICAL_PREFIX}/${siteSlug}${tail ? `/${tail}` : ""}`;
}

/**
 * The prefix links on a public page should use, from the browser path:
 * `/b/<site>` or `/t/<site>` when the visitor is on that path, "" on a custom
 * domain (whose root is the site).
 */
export function publicBaseFor(pathname: string, siteSlug: string): string {
  for (const prefix of MINIBLOG_PREFIXES) {
    const own = `/${prefix}/${siteSlug}`;
    if (pathname === own || pathname.startsWith(`${own}/`)) return own;
  }
  return "";
}
