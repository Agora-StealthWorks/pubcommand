import { FEEDS, isOneOf, type Feed } from "../../../../../modules/ispy/index";
import { intelAccess, type IntelScope } from "../intel/context";
import { ispyDb } from "./db";
import { orgFeeds, type Viewer } from "./read";

export type IspyOrgScope = {
  scope: IntelScope;
  viewer: Viewer & { orgId: string };
  /** The feeds this org may read. */
  feeds: Feed[];
  /** The feed asked for (?feed=), or the org's first. */
  feed: Feed;
  /** True when ?feed= names a feed this org cannot see. */
  locked: boolean;
};

/** Every ISpy org page starts here: Intel access + the org's feeds. */
export async function ispyOrgScope(slug: string | undefined, requested: string | undefined, need: "read" | "write" = "read"): Promise<{ ok: true; value: IspyOrgScope } | { ok: false; error: string }> {
  const access = await intelAccess(need, slug);
  if (!access.ok) return access;
  const feeds = await orgFeeds(access.scope.organizationId);
  const asked = isOneOf(FEEDS, requested) ? requested : null;
  const feed = asked ?? feeds[0] ?? "FINPUB";
  return {
    ok: true,
    value: {
      scope: access.scope,
      feeds,
      feed,
      locked: !feeds.includes(feed),
      viewer: { orgId: access.scope.organizationId, feeds: feeds.includes(feed) ? [feed] : [] },
    },
  };
}

/** Build a query string from params, dropping empty values. */
export function qs(params: Record<string, string | number | null | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== null && value !== undefined && value !== "") query.set(key, String(value));
  const text = query.toString();
  return text ? `?${text}` : "";
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Promos or copies in the viewer's feed whose headline/title matches, for the "Duplicate of…" picker. */
export async function searchDuplicateTargets(viewer: { feeds: Feed[] }, kind: "PROMO" | "COPY", q: string, excludeId: string): Promise<{ id: string; label: string; meta: string }[]> {
  const term = q.trim().slice(0, 120);
  if (term.length < 2 || !viewer.feeds.length) return [];
  return ispyDb(async (tx) => {
    if (kind === "PROMO") {
      const rows = await tx.ispyPromo.findMany({
        where: { feed: { in: viewer.feeds }, mergedIntoId: null, id: { not: excludeId }, OR: [{ headline: { contains: term, mode: "insensitive" } }, { landingUrl: { contains: term, mode: "insensitive" } }] },
        orderBy: { lastSeenOn: "desc" },
        take: 10,
        select: { id: true, headline: true, landingHost: true, sendCount: true },
      });
      return rows.map((r) => ({ id: r.id, label: r.headline ?? r.landingHost, meta: `${r.landingHost} · ${r.sendCount} sends` }));
    }
    const rows = await tx.ispyCopy.findMany({
      where: { feed: { in: viewer.feeds }, mergedIntoId: null, id: { not: excludeId }, title: { contains: term, mode: "insensitive" } },
      orderBy: { lastSeenAt: "desc" },
      take: 10,
      select: { id: true, title: true, sendCount: true, firstSeenAt: true },
    });
    return rows.map((r) => ({ id: r.id, label: r.title, meta: `${r.sendCount} sends · first ${r.firstSeenAt.toISOString().slice(0, 10)}` }));
  });
}

/** Read-only registry for the org app: publishers in the viewer's feeds, with publications, lists and gurus. */
export async function publisherDirectory(viewer: { orgId: string | null; feeds: Feed[] }, q?: string) {
  if (!viewer.feeds.length) return [];
  const term = q?.trim().slice(0, 120);
  return ispyDb((tx) =>
    tx.ispyPublisher.findMany({
      where: {
        deletedAt: null,
        feed: { in: viewer.feeds },
        type: { not: "GROUP" },
        ...(viewer.orgId ? { OR: [{ hideFromOtherOrgs: false }, { linkedOrganizationId: viewer.orgId }] } : {}),
        ...(term ? { name: { contains: term, mode: "insensitive" as const } } : {}),
      },
      orderBy: { name: "asc" },
      take: 300,
      select: {
        id: true,
        name: true,
        type: true,
        linkedOrganizationId: true,
        parent: { select: { name: true } },
        publications: { where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, gurus: { select: { role: true, guru: { select: { id: true, name: true } } } } } },
        lists: { where: { deletedAt: null, isIgnored: false }, orderBy: { name: "asc" }, select: { id: true, name: true, category: true, publicationId: true } },
      },
    }),
  );
}
