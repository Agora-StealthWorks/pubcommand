/**
 * Link-click tracking in Mini-Blog posts. PURE.
 *
 * Every http(s) link in a post (and its button) is stored as a TextLink row on
 * save. On the public page each link points at /b/<site>/go/<link id>, which
 * counts the click and redirects to the URL stored on that row. The redirect
 * target is NEVER taken from the request, so the route cannot be used as an
 * open redirect; and it is re-checked to be http(s) before redirecting.
 */

export type FoundLink = { url: string; label: string };

const ANCHOR_RE = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const HREF_RE = /\bhref\s*=\s*"([^"]*)"/i;

function decodeEntities(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

/** A URL we will ever redirect to: absolute http(s), no credentials, no whitespace, at most 2000 characters. */
export function isTrackableUrl(value: string | null | undefined): value is string {
  const text = (value ?? "").trim();
  if (!text || text.length > 2000 || /\s/.test(text)) return false;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  return Boolean(url.hostname);
}

/** Every distinct trackable link in sanitized post HTML, with its text (first one wins). */
export function extractLinks(html: string): FoundLink[] {
  const seen = new Map<string, FoundLink>();
  for (const match of html.matchAll(ANCHOR_RE)) {
    const href = HREF_RE.exec(match[1] ?? "")?.[1];
    if (!href) continue;
    const url = decodeEntities(href).trim();
    if (!isTrackableUrl(url) || seen.has(url)) continue;
    const label = decodeEntities((match[2] ?? "").replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim().slice(0, 200);
    seen.set(url, { url, label });
  }
  return [...seen.values()];
}

/** All links of a post: body links plus the button. */
export function postLinks(bodyHtml: string, buttonUrl: string | null | undefined, buttonText: string | null | undefined): FoundLink[] {
  const links = extractLinks(bodyHtml);
  if (isTrackableUrl(buttonUrl) && !links.some((link) => link.url === buttonUrl.trim())) links.push({ url: buttonUrl.trim(), label: (buttonText ?? "").trim().slice(0, 200) || "Button" });
  return links.slice(0, 200);
}

export const LINK_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The tracked path of a link: `<base>/go/<id>`. */
export function trackedPath(base: string, linkId: string): string {
  return `${base}/go/${linkId}`;
}

/**
 * Point every tracked link in the HTML at its counting redirect. Links that are
 * not in the map (mailto:, tel:, ones added after the last save) are left alone.
 */
export function rewriteLinks(html: string, hrefFor: (url: string) => string | null): string {
  return html.replace(ANCHOR_RE, (whole, attrs: string, inner: string) => {
    const href = HREF_RE.exec(attrs)?.[1];
    if (!href) return whole;
    const tracked = hrefFor(decodeEntities(href).trim());
    if (!tracked) return whole;
    return `<a${attrs.replace(HREF_RE, `href="${tracked.replace(/"/g, "%22")}"`)}>${inner}</a>`;
  });
}

export type StoredLink = { id: string; siteId: string; postId: string; url: string };

/**
 * Where /go/<id> sends the visitor: the stored URL of a link that belongs to
 * this site and to a post that is live, re-validated as http(s). Null → 404.
 */
export function redirectTarget(link: StoredLink | null, site: { id: string }, postLive: boolean): string | null {
  if (!link || link.siteId !== site.id || !postLive) return null;
  return isTrackableUrl(link.url) ? link.url.trim() : null;
}

export type ClickRow = { linkId: string; botReason: string | null };

/** Clicks per link, people only unless `includeBots`. */
export function clickCounts(rows: ClickRow[], includeBots = false): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.botReason && !includeBots) continue;
    counts.set(row.linkId, (counts.get(row.linkId) ?? 0) + 1);
  }
  return counts;
}
