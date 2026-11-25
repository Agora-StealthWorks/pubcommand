/**
 * The Mini-Blog stat engine, ported from the OxfordHub T-Letter site. PURE.
 *
 * - Views and clicks are first-party (the /px pixel and the /go redirect).
 * - "Unique" = distinct anonymous visitor ids (cookie `mb_vid`); a row with no
 *   visitor id (recorded before ids existed, or cookies blocked) counts as its own
 *   unique, so no data is lost. In SQL:
 *   COUNT(DISTINCT visitor_id) FILTER (WHERE visitor_id IS NOT NULL) + COUNT(*) FILTER (WHERE visitor_id IS NULL).
 * - Each link is typed: ad (a text ad), cta (the action button), content (in the body).
 * - CTR = unique clickers / unique views. A visitor clicking two links is one clicker.
 * - Clicks flagged as automated (bots, link scanners, data centers) are left out.
 */

export type LinkKind = "ad" | "cta" | "content";

export const LINK_KIND_LABEL: Record<LinkKind, string> = { ad: "Ad", cta: "CTA", content: "Content" };

export function linkKind(value: string | null | undefined): LinkKind {
  return value === "ad" || value === "cta" ? value : "content";
}

/** Aggregates, as the database returns them (COUNT, and the unique rule above). */
export type ViewAgg = { postId: string | null; views: number; unique: number };
export type ClickAgg = { postId: string; clicks: number; unique: number; flagged: number };
export type LinkAgg = { linkId: string; clicks: number; unique: number };
export type LinkRow = { id: string; postId: string; url: string; label: string; kind: string };

export type LinkStat = { id: string; url: string; label: string; kind: LinkKind; clicks: number; unique: number; ctr: number | null };

export type PostStats = {
  views: number;
  uniqueViews: number;
  clicks: number;
  uniqueClickers: number;
  /** Unique clickers / unique views; null with no views. */
  ctr: number | null;
  links: LinkStat[];
  /** Clicks left out as automated. */
  flagged: number;
};

export function ratio(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

export function formatPct(value: number | null): string {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}

export const EMPTY_STATS: PostStats = { views: 0, uniqueViews: 0, clicks: 0, uniqueClickers: 0, ctr: null, links: [], flagged: 0 };

/** Stats per post from the aggregates. Posts with no rows get zeros; links sort by unique clicks. */
export function postStats(postIds: readonly string[], views: readonly ViewAgg[], clicks: readonly ClickAgg[], linkClicks: readonly LinkAgg[], links: readonly LinkRow[]): Map<string, PostStats> {
  const viewBy = new Map(views.filter((row) => row.postId).map((row) => [row.postId!, row]));
  const clickBy = new Map(clicks.map((row) => [row.postId, row]));
  const linkBy = new Map(linkClicks.map((row) => [row.linkId, row]));
  const linksBy = new Map<string, LinkRow[]>();
  for (const link of links) {
    const list = linksBy.get(link.postId);
    if (list) list.push(link);
    else linksBy.set(link.postId, [link]);
  }
  const out = new Map<string, PostStats>();
  for (const postId of postIds) {
    const view = viewBy.get(postId);
    const click = clickBy.get(postId);
    const uniqueViews = view?.unique ?? 0;
    const uniqueClickers = click?.unique ?? 0;
    const postLinks = (linksBy.get(postId) ?? [])
      .map((link): LinkStat => {
        const agg = linkBy.get(link.id);
        const unique = agg?.unique ?? 0;
        return { id: link.id, url: link.url, label: link.label, kind: linkKind(link.kind), clicks: agg?.clicks ?? 0, unique, ctr: ratio(unique, uniqueViews) };
      })
      .sort((a, b) => b.unique - a.unique || b.clicks - a.clicks);
    out.set(postId, { views: view?.views ?? 0, uniqueViews, clicks: click?.clicks ?? 0, uniqueClickers, ctr: ratio(uniqueClickers, uniqueViews), links: postLinks, flagged: click?.flagged ?? 0 });
  }
  return out;
}

/** Clicks and unique clicks per link type (Ad, CTA, Content) for one post. */
export function byKind(links: readonly LinkStat[]): Record<LinkKind, { clicks: number; unique: number }> {
  const out: Record<LinkKind, { clicks: number; unique: number }> = { ad: { clicks: 0, unique: 0 }, cta: { clicks: 0, unique: 0 }, content: { clicks: 0, unique: 0 } };
  for (const link of links) {
    out[link.kind].clicks += link.clicks;
    out[link.kind].unique += link.unique;
  }
  return out;
}

/** One line for a Calendar chip: "1,204 views · 4.2% CTR". */
export function statsLine(stats: Pick<PostStats, "views" | "ctr">): string {
  return `${stats.views.toLocaleString("en-US")} view${stats.views === 1 ? "" : "s"} · ${formatPct(stats.ctr)} CTR`;
}

/** A fresh anonymous visitor id is valid only if it looks like one we minted. */
export function isVisitorId(value: string | null | undefined): value is string {
  return Boolean(value) && /^[0-9a-f-]{36}$/i.test(value!);
}
