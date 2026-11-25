import { tenantDb } from "@pubcommand/db";
import { statsForCalendarIssues } from "../miniblog/stats";
import { fromDay, toDay } from "../../../../../modules/editorial/dates";
import { eventFeedItem, issueFeedItem, type FeedItem } from "../../../../../modules/editorial/stages";
import { eventDates } from "./events";
import { UUID } from "./context";

export type PublicationView = { id: string; code: string; name: string; color: string; description: string | null; hasLogo: boolean; active: boolean; sortOrder: number };
export type ChannelView = { id: string; name: string; color: string };

export async function listPublications(organizationId: string, brandId: string, includeInactive = false): Promise<PublicationView[]> {
  const rows = await tenantDb(organizationId).calendarPublication.findMany({
    where: { brandId, ...(includeInactive ? {} : { active: true }) },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    select: { id: true, code: true, name: true, color: true, description: true, logoMime: true, logoOnDarkMime: true, active: true, sortOrder: true },
  });
  return rows.map(({ logoMime, logoOnDarkMime, ...row }) => ({ ...row, hasLogo: Boolean(logoMime || logoOnDarkMime) }));
}

export async function listChannels(organizationId: string, brandId: string): Promise<ChannelView[]> {
  return tenantDb(organizationId).calendarChannel.findMany({
    where: { brandId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, color: true },
  });
}

const EVENT_LIST_SELECT = {
  id: true,
  name: true,
  stage: true,
  eventType: true,
  format: true,
  channels: true,
  hosts: true,
  offer: true,
  seriesId: true,
  startTime: true,
  marketingStart: true,
  eventDate: true,
  eventEnd: true,
  marketingEnd: true,
} as const;

export type EventListRow = ReturnType<typeof toEventListRow>;
function toEventListRow(row: {
  id: string;
  name: string;
  stage: string;
  eventType: string | null;
  format: string | null;
  channels: string[];
  hosts: string[];
  offer: string | null;
  seriesId: string | null;
  startTime: string | null;
  marketingStart: Date | null;
  eventDate: Date | null;
  eventEnd: Date | null;
  marketingEnd: Date | null;
}) {
  return { ...row, ...eventDates(row) };
}

export type IssueListRow = {
  id: string;
  title: string;
  publicationCode: string;
  mailDate: string | null;
  status: string;
  issueType: string | null;
  subjectLines: string[];
  writer: string | null;
  hasStats: boolean;
  /** Stats of the Mini-Blog post that created this issue (views, unique views, CTR). */
  post: { views: number; uniqueViews: number; clicks: number; ctr: number | null } | null;
};

/** Events whose window overlaps [from, to], and issues mailed in it. Open-ended when bounds are null. */
export async function loadRange(organizationId: string, brandId: string, from: string | null, to: string | null) {
  const db = tenantDb(organizationId);
  const f = fromDay(from);
  const t = fromDay(to);
  const eventWhere = {
    brandId,
    deletedAt: null,
    ...(f || t
      ? {
          AND: [
            ...(t ? [{ OR: [{ marketingStart: { lte: t } }, { marketingStart: null, eventDate: { lte: t } }] }] : []),
            ...(f ? [{ OR: [{ marketingEnd: { gte: f } }, { eventEnd: { gte: f } }, { eventDate: { gte: f } }, { eventDate: null, marketingStart: { gte: f } }] }] : []),
          ],
        }
      : {}),
  };
  const [events, issues] = await Promise.all([
    db.calendarEvent.findMany({ where: eventWhere, select: EVENT_LIST_SELECT, orderBy: [{ eventDate: "asc" }, { name: "asc" }], take: 2000 }),
    db.calendarIssue.findMany({
      where: { brandId, deletedAt: null, ...(f || t ? { mailDate: { ...(f ? { gte: f } : {}), ...(t ? { lte: t } : {}) } } : {}) },
      select: { id: true, title: true, publicationCode: true, mailDate: true, status: true, issueType: true, subjectLines: true, writer: true, stat: { select: { id: true } } },
      orderBy: [{ mailDate: "asc" }, { title: "asc" }],
      take: 3000,
    }),
  ]);
  const postStats = await statsForCalendarIssues(
    organizationId,
    issues.map((issue) => issue.id),
  ).catch((error: unknown) => {
    console.warn("[calendar] Mini-Blog stats not loaded", error);
    return new Map<string, { views: number; uniqueViews: number; clicks: number; ctr: number | null }>();
  });
  return {
    events: events.map(toEventListRow),
    issues: issues.map(({ stat, mailDate, ...row }): IssueListRow => {
      const post = postStats.get(row.id);
      return { ...row, mailDate: toDay(mailDate), hasStats: Boolean(stat), post: post ? { views: post.views, uniqueViews: post.uniqueViews, clicks: post.clicks, ctr: post.ctr } : null };
    }),
  };
}

export function feedItems(range: Awaited<ReturnType<typeof loadRange>>): FeedItem[] {
  return [...range.events.map((e) => eventFeedItem(e)), ...range.issues.map((i) => issueFeedItem(i))];
}

export async function loadEvent(organizationId: string, brandId: string, id: string) {
  if (!UUID.test(id)) return null;
  const db = tenantDb(organizationId);
  const event = await db.calendarEvent.findFirst({ where: { id, brandId, deletedAt: null } });
  if (!event) return null;
  const series = event.seriesId ? await db.calendarSeries.findFirst({ where: { id: event.seriesId } }) : null;
  const followingCount =
    series && event.eventDate
      ? await db.calendarEvent.count({ where: { seriesId: series.id, deletedAt: null, id: { not: event.id }, eventDate: { gte: event.eventDate } } })
      : series
        ? await db.calendarEvent.count({ where: { seriesId: series.id, deletedAt: null, id: { not: event.id } } })
        : 0;
  return {
    event,
    dates: eventDates(event),
    series: series ? { id: series.id, frequency: series.frequency, until: toDay(series.until), active: series.active, startsOn: toDay(series.startsOn) } : null,
    followingCount,
  };
}

export type LoadedEvent = NonNullable<Awaited<ReturnType<typeof loadEvent>>>;

export async function loadIssue(organizationId: string, brandId: string, id: string) {
  if (!UUID.test(id)) return null;
  const issue = await tenantDb(organizationId).calendarIssue.findFirst({ where: { id, brandId, deletedAt: null }, include: { stat: true } });
  if (!issue) return null;
  return { issue, mailDate: toDay(issue.mailDate) };
}

export type LoadedIssue = NonNullable<Awaited<ReturnType<typeof loadIssue>>>;

/** Every send stat of a brand's live issues, as plain rows (mail date falls back to the issue's). */
export async function loadSendStats(organizationId: string, brandId: string) {
  const stats = await tenantDb(organizationId).calendarSendStat.findMany({
    where: { issue: { brandId, deletedAt: null } },
    select: {
      mailDate: true,
      delivered: true,
      openRate: true,
      clickRate: true,
      revenue: true,
      totalOpened: true,
      totalClicked: true,
      unsubscribes: true,
      subject: true,
      issue: { select: { id: true, title: true, publicationCode: true, mailDate: true, issueType: true, writer: true } },
    },
    take: 20000,
  });
  return stats.map((s) => ({
    issueId: s.issue.id,
    title: s.issue.title,
    issueType: s.issue.issueType,
    writer: s.issue.writer,
    subject: s.subject,
    mailDate: toDay(s.mailDate ?? s.issue.mailDate),
    pubCode: s.issue.publicationCode,
    delivered: s.delivered,
    openRate: s.openRate,
    clickRate: s.clickRate,
    revenue: s.revenue,
    totalOpened: s.totalOpened,
    totalClicked: s.totalClicked,
    unsubscribes: s.unsubscribes,
  }));
}
