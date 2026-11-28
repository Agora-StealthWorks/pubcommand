import type { Prisma } from "@pubcommand/db";
import { facetOptions, feedsForOrg, isOneOf, EMAIL_TYPES, FEEDS, type Feed, type FacetSelection } from "../../../../../modules/ispy/index";
import { asCopyExtraction } from "./brain";
import { ispyDb, type IspyTx } from "./db";

/**
 * Reads for the org app, the console and agents. A viewer is an organization (feeds
 * filtered, "internal" relative to it, hidden publishers removed) or the platform (null).
 */
export type Viewer = { orgId: string | null; feeds: Feed[] };

export async function orgFeeds(orgId: string): Promise<Feed[]> {
  return ispyDb(async (tx) => {
    const [brands, overrides] = await Promise.all([
      tx.brand.findMany({ where: { organizationId: orgId }, select: { niche: true } }),
      tx.ispyFeedAccess.findMany({ where: { orgId }, select: { feed: true, mode: true } }),
    ]);
    return feedsForOrg(brands.map((b) => b.niche), overrides);
  });
}

export const FEED_SORTS = ["date", "type", "sender", "subject", "seen"] as const;
export type FeedSort = (typeof FEED_SORTS)[number];
export type FeedKind = "INTERNAL" | "EXTERNAL" | "AFFILIATE";

export type FeedQuery = {
  feed?: Feed | null;
  kind?: FeedKind | null;
  type?: string | null;
  publisherId?: string | null;
  publicationId?: string | null;
  listId?: string | null;
  guruId?: string | null;
  topic?: string | null;
  q?: string | null;
  from?: Date | null;
  to?: Date | null;
  resentOnly?: boolean;
  routeStatus?: string | null;
  sort?: FeedSort;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

async function hiddenPublisherIds(tx: IspyTx, viewer: Viewer): Promise<string[]> {
  if (!viewer.orgId) return [];
  const rows = await tx.ispyPublisher.findMany({ where: { hideFromOtherOrgs: true, NOT: { linkedOrganizationId: viewer.orgId } }, select: { id: true } });
  return rows.map((r) => r.id);
}

async function linkedToViewer(tx: IspyTx, orgId: string) {
  const [pubs, publications] = await Promise.all([
    tx.ispyPublisher.findMany({ where: { linkedOrganizationId: orgId }, select: { id: true } }),
    tx.ispyPublication.findMany({ where: { OR: [{ linkedOrganizationId: orgId }, { publisher: { linkedOrganizationId: orgId } }] }, select: { id: true } }),
  ]);
  return { publisherIds: pubs.map((p) => p.id), publicationIds: publications.map((p) => p.id) };
}

async function feedWhere(tx: IspyTx, viewer: Viewer, q: FeedQuery): Promise<Prisma.IspyEmailWhereInput> {
  const feeds = q.feed && viewer.feeds.includes(q.feed) ? [q.feed] : viewer.feeds;
  const and: Prisma.IspyEmailWhereInput[] = [{ feed: { in: feeds } }];
  const hidden = await hiddenPublisherIds(tx, viewer);
  if (hidden.length) and.push({ OR: [{ publisherId: null }, { publisherId: { notIn: hidden } }] });
  if (q.kind) {
    if (q.kind === "AFFILIATE") and.push({ sendKind: "AFFILIATE" });
    else if (viewer.orgId) {
      const linked = await linkedToViewer(tx, viewer.orgId);
      const mine: Prisma.IspyEmailWhereInput = { OR: [{ publisherId: { in: linked.publisherIds } }, { publicationId: { in: linked.publicationIds } }] };
      and.push({ NOT: { sendKind: "AFFILIATE" } });
      and.push(q.kind === "INTERNAL" ? mine : { NOT: mine });
    } else {
      and.push(q.kind === "INTERNAL" ? { sendKind: "INTERNAL" } : { sendKind: "EXTERNAL" });
    }
  }
  if (q.type && isOneOf(EMAIL_TYPES, q.type)) and.push({ emailType: q.type });
  if (q.publisherId) and.push({ publisherId: q.publisherId });
  if (q.publicationId) and.push({ publicationId: q.publicationId });
  if (q.listId) and.push({ listId: q.listId });
  if (q.guruId) {
    const guru = await tx.ispyGuru.findUnique({ where: { id: q.guruId }, select: { name: true, aliases: true, lists: { select: { listId: true } } } });
    if (guru) and.push({ OR: [{ gurus: { hasSome: [guru.name, ...guru.aliases] } }, { listId: { in: guru.lists.map((l) => l.listId) } }] });
  }
  if (q.topic) and.push({ topics: { has: q.topic.toLowerCase() } });
  if (q.from) and.push({ receivedAt: { gte: q.from } });
  if (q.to) and.push({ receivedAt: { lte: q.to } });
  if (q.resentOnly) and.push({ copy: { sendCount: { gt: 1 } } });
  if (q.routeStatus) and.push({ routeStatus: q.routeStatus });
  if (q.q?.trim()) {
    const term = q.q.trim().slice(0, 200);
    and.push({ OR: [{ subject: { contains: term, mode: "insensitive" } }, { fromAddress: { contains: term, mode: "insensitive" } }, { fromName: { contains: term, mode: "insensitive" } }, { textBody: { contains: term, mode: "insensitive" } }] });
  }
  return { AND: and };
}

function feedOrder(sort: FeedSort, dir: "asc" | "desc"): Prisma.IspyEmailOrderByWithRelationInput[] {
  switch (sort) {
    case "type":
      return [{ emailType: dir }, { receivedAt: "desc" }];
    case "sender":
      return [{ fromName: { sort: dir, nulls: "last" } }, { receivedAt: "desc" }];
    case "subject":
      return [{ subject: dir }, { receivedAt: "desc" }];
    case "seen":
      return [{ copy: { sendCount: dir } }, { receivedAt: "desc" }];
    default:
      return [{ receivedAt: dir }];
  }
}

export type FeedRow = {
  id: string;
  receivedAt: Date;
  emailType: string;
  kind: FeedKind;
  subject: string;
  fromName: string | null;
  fromAddress: string;
  publisher: string | null;
  publication: string | null;
  list: string | null;
  advertiser: string | null;
  seen: number;
  subjects: number;
  copyId: string | null;
  promoId: string | null;
  isNewPromo: boolean;
  reuse: string | null;
  routeStatus: string;
};

export async function listFeed(viewer: Viewer, q: FeedQuery): Promise<{ rows: FeedRow[]; total: number; page: number; pageSize: number }> {
  const pageSize = Math.min(Math.max(q.pageSize ?? 50, 1), 200);
  const page = Math.max(q.page ?? 1, 1);
  return ispyDb(async (tx) => {
    const where = await feedWhere(tx, viewer, q);
    const [total, emails] = await Promise.all([
      tx.ispyEmail.count({ where }),
      tx.ispyEmail.findMany({
        where,
        orderBy: feedOrder(q.sort ?? "date", q.dir ?? "desc"),
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, receivedAt: true, emailType: true, sendKind: true, subject: true, fromName: true, fromAddress: true, publisherId: true, publicationId: true, routeStatus: true, copyId: true, promoId: true,
          list: { select: { name: true } },
          copy: { select: { sendCount: true, subjectCount: true, firstSeenKind: true, affiliateCount: true, firstSeenAt: true } },
          promo: { select: { firstSeenOn: true, advertiserLabel: true, advertiser: { select: { label: true } } } },
        },
      }),
    ]);
    const pubIds = [...new Set(emails.map((e) => e.publisherId).filter((x): x is string => !!x))];
    const publicationIds = [...new Set(emails.map((e) => e.publicationId).filter((x): x is string => !!x))];
    const [pubs, publications] = await Promise.all([
      tx.ispyPublisher.findMany({ where: { id: { in: pubIds } }, select: { id: true, name: true, linkedOrganizationId: true } }),
      tx.ispyPublication.findMany({ where: { id: { in: publicationIds } }, select: { id: true, name: true, linkedOrganizationId: true, publisher: { select: { linkedOrganizationId: true } } } }),
    ]);
    const pubMap = new Map(pubs.map((p) => [p.id, p]));
    const publicationMap = new Map(publications.map((p) => [p.id, p]));
    const rows = emails.map((e): FeedRow => {
      const publisher = e.publisherId ? pubMap.get(e.publisherId) : undefined;
      const publication = e.publicationId ? publicationMap.get(e.publicationId) : undefined;
      const mine = !!viewer.orgId && (publisher?.linkedOrganizationId === viewer.orgId || publication?.linkedOrganizationId === viewer.orgId || publication?.publisher.linkedOrganizationId === viewer.orgId);
      const kind: FeedKind = e.sendKind === "AFFILIATE" ? "AFFILIATE" : viewer.orgId ? (mine ? "INTERNAL" : "EXTERNAL") : (e.sendKind as FeedKind);
      const seen = e.copy?.sendCount ?? 1;
      let reuse: string | null = null;
      if (e.copy && seen > 1) {
        if (e.sendKind === "AFFILIATE" && e.copy.firstSeenKind !== "AFFILIATE") reuse = `first sent ${e.copy.firstSeenKind.toLowerCase()}ly ${e.copy.firstSeenAt.toISOString().slice(0, 10)}`;
        else if ((e.copy.subjectCount ?? 1) > 1) reuse = `seen ${seen}× · ${e.copy.subjectCount} subjects`;
        else reuse = `seen ${seen}×`;
      }
      return {
        id: e.id,
        receivedAt: e.receivedAt,
        emailType: e.emailType,
        kind,
        subject: e.subject,
        fromName: e.fromName,
        fromAddress: e.fromAddress,
        publisher: publisher?.name ?? null,
        publication: publication?.name ?? null,
        list: e.list?.name ?? null,
        advertiser: e.promo ? e.promo.advertiserLabel ?? e.promo.advertiser.label : null,
        seen,
        subjects: e.copy?.subjectCount ?? 1,
        copyId: e.copyId,
        promoId: e.promoId,
        isNewPromo: !!e.promo && e.promo.firstSeenOn.toISOString().slice(0, 10) === e.receivedAt.toISOString().slice(0, 10),
        reuse,
        routeStatus: e.routeStatus,
      };
    });
    return { rows, total, page, pageSize };
  });
}

/** Counts per tab for the feed header. */
export async function feedCounts(viewer: Viewer, q: FeedQuery): Promise<Record<FeedKind, number>> {
  const kinds: FeedKind[] = ["INTERNAL", "EXTERNAL", "AFFILIATE"];
  const counts = await ispyDb(async (tx) => Promise.all(kinds.map(async (kind) => tx.ispyEmail.count({ where: await feedWhere(tx, viewer, { ...q, kind }) }))));
  return { INTERNAL: counts[0]!, EXTERNAL: counts[1]!, AFFILIATE: counts[2]! };
}

/** Linked dropdown options: picking any one narrows the others. */
export async function feedFacets(viewer: Viewer, sel: FacetSelection) {
  return ispyDb(async (tx) => {
    const hidden = await hiddenPublisherIds(tx, viewer);
    const [publishers, publications, lists, gurus] = await Promise.all([
      tx.ispyPublisher.findMany({ where: { deletedAt: null, feed: { in: viewer.feeds }, type: { not: "GROUP" }, id: { notIn: hidden } }, select: { id: true, name: true } }),
      tx.ispyPublication.findMany({ where: { deletedAt: null, publisher: { feed: { in: viewer.feeds }, id: { notIn: hidden } } }, select: { id: true, name: true, publisherId: true } }),
      tx.ispyList.findMany({ where: { deletedAt: null, isIgnored: false, publisher: { feed: { in: viewer.feeds }, id: { notIn: hidden } } }, select: { id: true, name: true, publisherId: true, publicationId: true } }),
      tx.ispyGuru.findMany({ where: { feed: { in: viewer.feeds }, isIgnored: false }, select: { id: true, name: true, publisherId: true, publications: { select: { publicationId: true } }, lists: { where: { isIgnored: false }, select: { listId: true } } } }),
    ]);
    return facetOptions(
      { publishers, publications, lists, gurus: gurus.map((g) => ({ id: g.id, name: g.name, publisherId: g.publisherId, publicationIds: g.publications.map((p) => p.publicationId), listIds: g.lists.map((l) => l.listId) })) },
      sel,
    );
  });
}

async function visibleTo(tx: IspyTx, viewer: Viewer, row: { feed: string; publisherId: string | null }): Promise<boolean> {
  if (!viewer.feeds.includes(row.feed as Feed)) return false;
  if (!viewer.orgId || !row.publisherId) return true;
  const p = await tx.ispyPublisher.findUnique({ where: { id: row.publisherId }, select: { hideFromOtherOrgs: true, linkedOrganizationId: true } });
  return !p?.hideFromOtherOrgs || p.linkedOrganizationId === viewer.orgId;
}

export async function getEmail(viewer: Viewer, id: string) {
  return ispyDb(async (tx) => {
    const e = await tx.ispyEmail.findUnique({
      where: { id },
      include: {
        list: { select: { id: true, name: true, category: true } },
        inbox: { select: { address: true, level: true } },
        receivedInbox: { select: { address: true, level: true } },
        copy: { select: { id: true, title: true, sendCount: true, subjectCount: true, emailType: true } },
        promo: { select: { id: true, headline: true, landingUrl: true } },
      },
    });
    if (!e || !(await visibleTo(tx, viewer, e))) return null;
    const [publisher, publication, rule] = await Promise.all([
      e.publisherId ? tx.ispyPublisher.findUnique({ where: { id: e.publisherId }, select: { id: true, name: true, linkedOrganizationId: true } }) : null,
      e.publicationId ? tx.ispyPublication.findUnique({ where: { id: e.publicationId }, select: { id: true, name: true, linkedOrganizationId: true } }) : null,
      e.routedByRuleId ? tx.ispyRoutingRule.findUnique({ where: { id: e.routedByRuleId }, select: { id: true, priority: true, conditions: true, action: true } }) : null,
    ]);
    return { ...e, publisher, publication, rule };
  });
}

export async function getCopy(viewer: Viewer, id: string) {
  return ispyDb(async (tx) => {
    let copy = await tx.ispyCopy.findUnique({ where: { id } });
    if (copy?.mergedIntoId) copy = await tx.ispyCopy.findUnique({ where: { id: copy.mergedIntoId } });
    if (!copy || !viewer.feeds.includes(copy.feed as Feed)) return null;
    const hidden = await hiddenPublisherIds(tx, viewer);
    const sends = await tx.ispyEmail.findMany({
      where: { copyId: copy.id, ...(hidden.length ? { OR: [{ publisherId: null }, { publisherId: { notIn: hidden } }] } : {}) },
      orderBy: { receivedAt: "asc" },
      select: { id: true, receivedAt: true, subject: true, sendKind: true, copyMatch: true, publisherId: true, publicationId: true, textBody: true, list: { select: { name: true } } },
    });
    if (!sends.length) return null;
    const pubs = await tx.ispyPublisher.findMany({ where: { id: { in: sends.map((s) => s.publisherId).filter((x): x is string => !!x) } }, select: { id: true, name: true, linkedOrganizationId: true } });
    const promo = copy.promoId ? await tx.ispyPromo.findUnique({ where: { id: copy.promoId }, select: { id: true, headline: true, advertiserLabel: true, advertiser: { select: { label: true } } } }) : null;
    const pubMap = new Map(pubs.map((p) => [p.id, p]));
    const seenSubjects = new Set<string>();
    return {
      copy: { ...copy, extraction: asCopyExtraction(copy.extraction) },
      promo,
      text: sends[0]!.textBody,
      sends: sends.map((s) => {
        const key = s.subject.trim().toLowerCase();
        const newSubject = seenSubjects.size > 0 && !seenSubjects.has(key);
        seenSubjects.add(key);
        const p = s.publisherId ? pubMap.get(s.publisherId) : undefined;
        const kind = s.sendKind === "AFFILIATE" ? "AFFILIATE" : viewer.orgId && p?.linkedOrganizationId === viewer.orgId ? "INTERNAL" : s.sendKind;
        return { id: s.id, receivedAt: s.receivedAt, subject: s.subject, kind, match: s.copyMatch, list: s.list?.name ?? null, publisher: p?.name ?? null, newSubject };
      }),
    };
  });
}

export async function getPromo(viewer: Viewer, id: string) {
  return ispyDb(async (tx) => {
    let promo = await tx.ispyPromo.findUnique({ where: { id }, include: { advertiser: true } });
    if (promo?.mergedIntoId) promo = await tx.ispyPromo.findUnique({ where: { id: promo.mergedIntoId }, include: { advertiser: true } });
    if (!promo || !viewer.feeds.includes(promo.feed as Feed)) return null;
    const [aliases, landing, sightings, copies] = await Promise.all([
      tx.ispyPromoAlias.findMany({ where: { promoId: promo.id }, select: { key: true, source: true }, take: 50 }),
      tx.ispyLandingPage.findMany({ where: { promoId: promo.id }, orderBy: { fetchedAt: "desc" }, take: 5 }),
      tx.ispyPromoSighting.findMany({ where: { promoId: promo.id }, orderBy: { day: "asc" }, take: 500, select: { day: true, subject: true, sendKind: true, publisherId: true, listId: true, emailId: true, isFirstEver: true } }),
      tx.ispyCopy.findMany({ where: { promoId: promo.id, mergedIntoId: null }, select: { id: true, title: true, sendCount: true }, orderBy: { sendCount: "desc" }, take: 20 }),
    ]);
    const hidden = new Set(await hiddenPublisherIds(tx, viewer));
    const visibleSightings = sightings.filter((s) => !s.publisherId || !hidden.has(s.publisherId));
    const pubs = await tx.ispyPublisher.findMany({ where: { id: { in: visibleSightings.map((s) => s.publisherId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
    const lists = await tx.ispyList.findMany({ where: { id: { in: visibleSightings.map((s) => s.listId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
    const pubName = new Map(pubs.map((p) => [p.id, p.name]));
    const listName = new Map(lists.map((l) => [l.id, l.name]));
    return {
      promo,
      aliases,
      landing: landing[0] ?? null,
      copies,
      sightings: visibleSightings.map((s) => ({ ...s, publisher: s.publisherId ? pubName.get(s.publisherId) ?? null : null, list: s.listId ? listName.get(s.listId) ?? null : null })),
    };
  });
}

export const RADAR_SORTS = ["first", "headline", "advertiser", "kind", "days", "sends", "affiliates", "last"] as const;
export type RadarSort = (typeof RADAR_SORTS)[number];

export async function promoRadar(viewer: Viewer, input: { feed: Feed; weekStart: Date; sort?: RadarSort; dir?: "asc" | "desc"; onlyNew?: boolean }) {
  const weekEnd = new Date(input.weekStart.getTime() + 7 * 86_400_000);
  const dir = input.dir ?? "desc";
  const orderBy: Prisma.IspyPromoOrderByWithRelationInput[] = (() => {
    switch (input.sort) {
      case "headline":
        return [{ headline: dir }];
      case "advertiser":
        return [{ advertiser: { label: dir } }];
      case "kind":
        return [{ kind: dir }];
      case "days":
        return [{ daysDetected: dir }];
      case "sends":
        return [{ sendCount: dir }];
      case "affiliates":
        return [{ affiliateCount: dir }];
      case "last":
        return [{ lastSeenOn: dir }];
      default:
        return [{ firstSeenOn: dir }];
    }
  })();
  if (!viewer.feeds.includes(input.feed)) return { promos: [], newCount: 0, running: 0 };
  return ispyDb(async (tx) => {
    const promos = await tx.ispyPromo.findMany({
      where: { feed: input.feed, mergedIntoId: null, sightings: { some: { day: { gte: input.weekStart, lt: weekEnd } } }, ...(input.onlyNew ? { firstSeenOn: { gte: input.weekStart, lt: weekEnd } } : {}) },
      orderBy: [...orderBy, { id: "asc" }],
      take: 300,
      select: { id: true, headline: true, kind: true, firstSeenOn: true, lastSeenOn: true, daysDetected: true, sendCount: true, affiliateCount: true, landingUrl: true, advertiserLabel: true, advertiser: { select: { label: true } } },
    });
    const rows = promos.map((p) => ({ ...p, advertiserName: p.advertiserLabel ?? p.advertiser.label, isNew: p.firstSeenOn >= input.weekStart && p.firstSeenOn < weekEnd }));
    return { promos: rows, newCount: rows.filter((r) => r.isNew).length, running: rows.length };
  });
}

export async function trendWeek(viewer: Viewer, feed: Feed, weekStart: Date) {
  if (!viewer.feeds.includes(feed)) return null;
  return ispyDb((tx) => tx.ispyTrendWeek.findUnique({ where: { feed_weekStart: { feed, weekStart } } }));
}

export async function trendWeeks(feed: Feed, take = 12) {
  return ispyDb((tx) => tx.ispyTrendWeek.findMany({ where: { feed }, orderBy: { weekStart: "desc" }, take, select: { weekStart: true } }));
}

/** Reuse, spike and silence alerts for the feed sidebar and agents. */
export async function alerts(viewer: Viewer, feed?: Feed | null) {
  const feeds = feed && viewer.feeds.includes(feed) ? [feed] : viewer.feeds;
  const since = new Date(Date.now() - 7 * 86_400_000);
  return ispyDb(async (tx) => {
    const [reusedToAffiliate, newSubjects, silent, spikes] = await Promise.all([
      tx.ispyCopy.findMany({ where: { feed: { in: feeds }, mergedIntoId: null, firstSeenKind: { not: "AFFILIATE" }, affiliateCount: { gt: 0 }, lastSeenAt: { gte: since } }, orderBy: { lastSeenAt: "desc" }, take: 10, select: { id: true, title: true, firstSeenKind: true, firstSeenAt: true } }),
      tx.ispyCopy.findMany({ where: { feed: { in: feeds }, mergedIntoId: null, subjectCount: { gt: 1 }, lastSeenAt: { gte: since } }, orderBy: { lastSeenAt: "desc" }, take: 10, select: { id: true, title: true, subjectCount: true, sendCount: true } }),
      tx.ispyInbox.findMany({ where: { feed: { in: feeds }, status: "SILENT" }, take: 10, select: { id: true, address: true, lastMessageAt: true, list: { select: { name: true } }, publication: { select: { name: true } } } }),
      tx.$queryRaw<{ id: string; headline: string | null; sends: bigint }[]>`
        SELECT p.id, p.headline, COUNT(*) AS sends FROM ispy_promo_sightings s JOIN ispy_promos p ON p.id = s.promo_id
        WHERE s.day >= ${new Date(Date.now() - 2 * 86_400_000)} AND p.feed = ANY(${feeds}::text[]) AND p.merged_into_id IS NULL
        GROUP BY p.id, p.headline HAVING COUNT(*) >= 5 ORDER BY sends DESC LIMIT 10`,
    ]);
    return { reusedToAffiliate, newSubjects, silent, spikes: spikes.map((s) => ({ ...s, sends: Number(s.sends) })) };
  });
}

/** Week headline numbers for the feed sidebar. */
export async function weekNumbers(viewer: Viewer, feed: Feed) {
  if (!viewer.feeds.includes(feed)) return null;
  const since = new Date(Date.now() - 7 * 86_400_000);
  return ispyDb(async (tx) => {
    const [emails, newPromos, resent, affiliateReuse] = await Promise.all([
      tx.ispyEmail.count({ where: { feed, receivedAt: { gte: since } } }),
      tx.ispyPromo.count({ where: { feed, mergedIntoId: null, firstSeenOn: { gte: since } } }),
      tx.ispyEmail.count({ where: { feed, receivedAt: { gte: since }, copy: { sendCount: { gt: 1 } } } }),
      tx.ispyCopy.count({ where: { feed, mergedIntoId: null, firstSeenKind: { not: "AFFILIATE" }, affiliateCount: { gt: 0 }, lastSeenAt: { gte: since } } }),
    ]);
    return { emails, newPromos, resent, affiliateReuse };
  });
}

export function parseFeed(value: unknown, fallback: Feed): Feed {
  return isOneOf(FEEDS, value) ? value : fallback;
}
