import { tenantDb } from "@pubcommand/db";
import { LINK_ID_RE, postLinks, redirectTarget, trackedPath } from "../../../../../modules/miniblog/links";
import { postState } from "../../../../../modules/miniblog/site";
import { classifyTraffic, clientIpOf } from "../../../../../modules/funnels/traffic";
import { loadPublicSite, publicSiteMatches, visitorCookie, visitorOf } from "./public";
import { PREVIEW_PARAM, currentPreviewToken } from "@/lib/preview-token";

/** "?preview=1" plus the request's preview token, if it came with one. */
async function currentPreviewQuery(): Promise<string> {
  const token = await currentPreviewToken();
  return token ? `?preview=1&${PREVIEW_PARAM}=${encodeURIComponent(token)}` : "?preview=1";
}

/**
 * Keep one TextLink row per link in the post (body links and the button).
 * Rows for links that were removed stay, so their past clicks still count.
 */
export async function syncPostLinks(
  organizationId: string,
  post: { id: string; siteId: string; bodyHtml: string; buttonUrl: string | null; buttonText: string | null; adLinks?: { url: string | null; label: string }[] },
): Promise<number> {
  const db = tenantDb(organizationId);
  const links = postLinks(post.bodyHtml, post.buttonUrl, post.buttonText, post.adLinks ?? []);
  if (!links.length) return 0;
  const existing = await db.textLink.findMany({ where: { postId: post.id }, select: { id: true, url: true, kind: true } });
  const known = new Map(existing.map((row) => [row.url, row]));
  let created = 0;
  for (const link of links) {
    const row = known.get(link.url);
    if (row) {
      // A link that became the button or an ad is reported as such from now on.
      if (link.kind && link.kind !== "content" && row.kind !== link.kind) await db.textLink.updateMany({ where: { id: row.id }, data: { kind: link.kind } });
      continue;
    }
    await db.textLink
      .create({ data: { organizationId, siteId: post.siteId, postId: post.id, url: link.url, label: link.label, kind: link.kind ?? "content" } })
      .then(() => (created += 1))
      .catch(() => undefined); // A concurrent save created it.
  }
  return created;
}

/** url → tracked href for one or more posts, for rendering. */
export async function trackedHrefs(organizationId: string, postIds: string[], base: string, preview = false): Promise<Map<string, Map<string, string>>> {
  const previewQuery = preview ? await currentPreviewQuery() : "";
  const rows = postIds.length ? await tenantDb(organizationId).textLink.findMany({ where: { postId: { in: postIds } }, select: { id: true, postId: true, url: true } }) : [];
  const byPost = new Map<string, Map<string, string>>();
  for (const row of rows) {
    const map = byPost.get(row.postId) ?? new Map<string, string>();
    // Previews carry ?preview=1 (and the preview token, for custom domains) so staff clicks are never counted.
    map.set(row.url, `${trackedPath(base, row.id)}${preview ? previewQuery : ""}`);
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
  const response = new Response(null, { status: 302, headers: { location: target, "cache-control": "no-store", "referrer-policy": "strict-origin-when-cross-origin" } });
  if (!loaded.preview) {
    // Same anonymous visitor id as the view pixel, so unique clicks and CTR line up.
    const visitor = visitorOf(request);
    if (visitor.fresh) response.headers.append("set-cookie", visitorCookie(visitor.id));
    const botReason = classifyTraffic({ userAgent: request.headers.get("user-agent"), ip: clientIpOf(request.headers) });
    await db.textLinkClick
      .create({ data: { organizationId: loaded.organizationId, siteId: loaded.site.id, postId: link.postId, linkId: link.id, botReason, visitorId: visitor.id } })
      .catch((error: unknown) => console.warn("[miniblog] click not recorded", error));
  }
  return response;
}

/** GET /b/<site>/asset/<id>: an image uploaded into a post (public by nature). */
export async function siteAsset(orgSlug: string, siteSlug: string, assetId: string): Promise<Response> {
  if (!LINK_ID_RE.test(assetId) || !(await publicSiteMatches(orgSlug))) return notFound();
  const loaded = await loadPublicSite(orgSlug, siteSlug, { preview: "1", assets: true });
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
