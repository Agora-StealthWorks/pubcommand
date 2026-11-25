import { rawPrisma, tenantDb, withOrgContext } from "@pubcommand/db";
import { EMPTY_STATS, postStats, ratio, type ClickAgg, type LinkAgg, type PostStats, type ViewAgg } from "../../../../../modules/miniblog/stats";

/**
 * The Mini-Blog stat engine (the T-Letter site's, on PubCommand's tables):
 * views and unique views per post, clicks, unique clickers, CTR and per-link
 * clicks typed Ad / CTA / Content. Counted in SQL inside the org's RLS context.
 */

const UNIQUE = `COUNT(DISTINCT visitor_id) FILTER (WHERE visitor_id IS NOT NULL) + COUNT(*) FILTER (WHERE visitor_id IS NULL)`;

type Num = number | bigint | string;
const n = (value: Num | null | undefined) => Number(value ?? 0);

/** Stats for these posts (one organization). */
export async function loadPostStats(organizationId: string, postIds: string[]): Promise<Map<string, PostStats>> {
  if (!postIds.length) return new Map();
  const [views, clicks, linkClicks] = await withOrgContext(rawPrisma(), organizationId, async (tx) =>
    Promise.all([
      tx.$queryRawUnsafe<{ post_id: string; views: Num; uniq: Num }[]>(
        `SELECT post_id, COUNT(*) AS views, ${UNIQUE} AS uniq FROM text_views WHERE organization_id = $1::uuid AND post_id = ANY($2::uuid[]) GROUP BY post_id`,
        organizationId,
        postIds,
      ),
      tx.$queryRawUnsafe<{ post_id: string; clicks: Num; uniq: Num; flagged: Num }[]>(
        `SELECT post_id, COUNT(*) FILTER (WHERE bot_reason IS NULL) AS clicks,
                COUNT(DISTINCT visitor_id) FILTER (WHERE bot_reason IS NULL AND visitor_id IS NOT NULL) + COUNT(*) FILTER (WHERE bot_reason IS NULL AND visitor_id IS NULL) AS uniq,
                COUNT(*) FILTER (WHERE bot_reason IS NOT NULL) AS flagged
         FROM text_link_clicks WHERE organization_id = $1::uuid AND post_id = ANY($2::uuid[]) GROUP BY post_id`,
        organizationId,
        postIds,
      ),
      tx.$queryRawUnsafe<{ link_id: string; clicks: Num; uniq: Num }[]>(
        `SELECT link_id, COUNT(*) AS clicks, ${UNIQUE} AS uniq FROM text_link_clicks WHERE organization_id = $1::uuid AND post_id = ANY($2::uuid[]) AND bot_reason IS NULL GROUP BY link_id`,
        organizationId,
        postIds,
      ),
    ]),
  );
  const links = await tenantDb(organizationId).textLink.findMany({ where: { postId: { in: postIds } }, orderBy: { createdAt: "asc" }, select: { id: true, postId: true, url: true, label: true, kind: true } });
  return postStats(
    postIds,
    views.map((row): ViewAgg => ({ postId: row.post_id, views: n(row.views), unique: n(row.uniq) })),
    clicks.map((row): ClickAgg => ({ postId: row.post_id, clicks: n(row.clicks), unique: n(row.uniq), flagged: n(row.flagged) })),
    linkClicks.map((row): LinkAgg => ({ linkId: row.link_id, clicks: n(row.clicks), unique: n(row.uniq) })),
    links,
  );
}

export async function loadOnePostStats(organizationId: string, postId: string): Promise<PostStats> {
  return (await loadPostStats(organizationId, [postId])).get(postId) ?? EMPTY_STATS;
}

export type SiteTotals = { views: number; uniqueViews: number; clicks: number; uniqueClickers: number; ctr: number | null; subscribers: number };

/** Whole-Mini-Blog totals: every page view (home, posts, subscribe page) and every people click. */
export async function loadSiteTotals(organizationId: string, siteId: string): Promise<SiteTotals> {
  const [views, clicks] = await withOrgContext(rawPrisma(), organizationId, async (tx) =>
    Promise.all([
      tx.$queryRawUnsafe<{ views: Num; uniq: Num }[]>(`SELECT COUNT(*) AS views, ${UNIQUE} AS uniq FROM text_views WHERE organization_id = $1::uuid AND site_id = $2::uuid`, organizationId, siteId),
      tx.$queryRawUnsafe<{ clicks: Num; uniq: Num }[]>(`SELECT COUNT(*) AS clicks, ${UNIQUE} AS uniq FROM text_link_clicks WHERE organization_id = $1::uuid AND site_id = $2::uuid AND bot_reason IS NULL`, organizationId, siteId),
    ]),
  );
  const subscribers = await tenantDb(organizationId).textOptin.count({ where: { siteId } });
  const uniqueViews = n(views[0]?.uniq);
  const uniqueClickers = n(clicks[0]?.uniq);
  return { views: n(views[0]?.views), uniqueViews, clicks: n(clicks[0]?.clicks), uniqueClickers, ctr: ratio(uniqueClickers, uniqueViews), subscribers };
}

/** Calendar issue id → the stats of the Mini-Blog post that created it. */
export async function statsForCalendarIssues(organizationId: string, issueIds: string[]): Promise<Map<string, PostStats & { postId: string; siteId: string; siteName: string }>> {
  if (!issueIds.length) return new Map();
  const db = tenantDb(organizationId);
  const posts = await db.textPost.findMany({ where: { calendarIssueId: { in: issueIds }, deletedAt: null }, select: { id: true, calendarIssueId: true, siteId: true } });
  if (!posts.length) return new Map();
  const [stats, sites] = await Promise.all([
    loadPostStats(
      organizationId,
      posts.map((post) => post.id),
    ),
    db.textSite.findMany({ where: { id: { in: [...new Set(posts.map((post) => post.siteId))] } }, select: { id: true, name: true } }),
  ]);
  const siteName = new Map(sites.map((site) => [site.id, site.name]));
  return new Map(posts.map((post) => [post.calendarIssueId!, { ...(stats.get(post.id) ?? EMPTY_STATS), postId: post.id, siteId: post.siteId, siteName: siteName.get(post.siteId) ?? "Mini-Blog" }]));
}
