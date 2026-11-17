import { tenantDb } from "@pubcommand/db";
import { LINK_ID_RE, postLinks, redirectTarget, trackedPath } from "../../../../../modules/miniblog/links";
import { postState } from "../../../../../modules/miniblog/site";
import { classifyTraffic, clientIpOf } from "../../../../../modules/funnels/traffic";
import { loadPublicSite, publicSiteMatches } from "./public";

/**
 * Keep one TextLink row per link in the post (body links and the button).
 * Rows for links that were removed stay, so their past clicks still count.
 */
export async function syncPostLinks(organizationId: string, post: { id: string; siteId: string; bodyHtml: string; buttonUrl: string | null; buttonText: string | null }): Promise<number> {
  const db = tenantDb(organizationId);
  const links = postLinks(post.bodyHtml, post.buttonUrl, post.buttonText);
  if (!links.length) return 0;
  const existing = await db.textLink.findMany({ where: { postId: post.id }, select: { url: true } });
  const known = new Set(existing.map((row) => row.url));
  let created = 0;
  for (const link of links) {
    if (known.has(link.url)) continue;
    await db.textLink
      .create({ data: { organizationId, siteId: post.siteId, postId: post.id, url: link.url, label: link.label } })
      .then(() => (created += 1))
      .catch(() => undefined); // A concurrent save created it.
  }
  return created;
}

/** url → tracked href for one or more posts, for rendering. */
export async function trackedHrefs(organizationId: string, postIds: string[], base: string, preview = false): Promise<Map<string, Map<string, string>>> {
  const rows = postIds.length ? await tenantDb(organizationId).textLink.findMany({ where: { postId: { in: postIds } }, select: { id: true, postId: true, url: true } }) : [];
  const byPost = new Map<string, Map<string, string>>();
  for (const row of rows) {
    const map = byPost.get(row.postId) ?? new Map<string, string>();
    // Previews carry ?preview=1 so staff clicks are never counted.
    map.set(row.url, `${trackedPath(base, row.id)}${preview ? "?preview=1" : ""}`);
    byPost.set(row.postId, map);
  }
  return byPost;
}

/** Clicks per link of one post, people and flagged separately (admin). */
export async function postLinkStats(organizationId: string, postId: string) {
  const db = tenantDb(organizationId);
  const [links, clicks] = await Promise.all([
    db.textLink.findMany({ where: { postId }, orderBy: { createdAt: "asc" }, select: { id: true, url: true, label: true } }),
    db.textLinkClick.findMany({ where: { postId }, select: { linkId: true, botReason: true }, take: 200_000 }),
  ]);
  const people = new Map<string, number>();
  const flagged = new Map<string, number>();
  for (const click of clicks) (click.botReason ? flagged : people).set(click.linkId, ((click.botReason ? flagged : people).get(click.linkId) ?? 0) + 1);
  return links.map((link) => ({ ...link, clicks: people.get(link.id) ?? 0, flagged: flagged.get(link.id) ?? 0 }));
}

/** People-only click totals per post, for the posts table. */
export async function clickTotals(organizationId: string, siteId: string): Promise<Map<string, number>> {
  const rows = await tenantDb(organizationId).textLinkClick.findMany({ where: { siteId, botReason: null }, select: { postId: true }, take: 500_000 });
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.postId, (totals.get(row.postId) ?? 0) + 1);
  return totals;
}

function notFound() {
  return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
}

/**
 * GET /b/<site>/go/<link id>: count the click, then 302 to the URL stored on
 * that link. Never redirects anywhere a request names (no open redirect), and
 * never counts previews. Bot and data-center clicks are stored flagged.
 */
export async function handleLinkClick(request: Request, orgSlug: string, siteSlug: string, linkId: string): Promise<Response> {
  if (!LINK_ID_RE.test(linkId) || !(await publicSiteMatches(orgSlug))) return notFound();
  const preview = new URL(request.url).searchParams.get("preview") === "1";
  const loaded = await loadPublicSite(orgSlug, siteSlug, preview ? { preview: "1" } : {});
  if (!loaded) return notFound();
  const db = tenantDb(loaded.organizationId);
  const link = await db.textLink.findFirst({ where: { id: linkId, siteId: loaded.site.id } });
  const post = link ? await db.textPost.findFirst({ where: { id: link.postId, siteId: loaded.site.id, deletedAt: null }, select: { status: true, publishAt: true } }) : null;
  const live = Boolean(post && (loaded.preview || postState(post, loaded.now) === "published"));
  const target = redirectTarget(link, loaded.site, live);
  if (!link || !target) return notFound();
  if (!loaded.preview) {
    const botReason = classifyTraffic({ userAgent: request.headers.get("user-agent"), ip: clientIpOf(request.headers) });
    await db.textLinkClick
      .create({ data: { organizationId: loaded.organizationId, siteId: loaded.site.id, postId: link.postId, linkId: link.id, botReason } })
      .catch((error: unknown) => console.warn("[miniblog] click not recorded", error));
  }
  return new Response(null, { status: 302, headers: { location: target, "cache-control": "no-store", "referrer-policy": "strict-origin-when-cross-origin" } });
}

/** GET /b/<site>/asset/<id>: an image uploaded into a post (public by nature). */
export async function siteAsset(orgSlug: string, siteSlug: string, assetId: string): Promise<Response> {
  if (!LINK_ID_RE.test(assetId) || !(await publicSiteMatches(orgSlug))) return notFound();
  const loaded = await loadPublicSite(orgSlug, siteSlug, { preview: "1" });
  const asset = loaded ? await tenantDb(loaded.organizationId).funnelAsset.findFirst({ where: { id: assetId, ownerId: loaded.site.id, kind: { in: ["post_image", "logo"] } } }) : null;
  if (!asset) return notFound();
  return new Response(Buffer.from(asset.data), {
    headers: {
      "content-type": asset.mimeType,
      "content-length": String(asset.size),
      "cache-control": "public, max-age=86400",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'",
    },
  });
}
