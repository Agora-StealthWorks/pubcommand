import { appendOrgAudit, tenantDb } from "@pubcommand/db";
import { stripContentAd } from "../../../../../modules/miniblog/ads";
import { parseTickers } from "../../../../../modules/miniblog/post-fields";
import { calendarStatusFor, excerpt } from "../../../../../modules/miniblog/site";
import { formatZoned, zonedDayKey } from "../../../../../modules/miniblog/time";
import { orgTimezone } from "./data";

export type CalendarSync = "created" | "updated" | "skipped";

/**
 * Every Mini-Blog post is one Marketing Calendar issue under the Mini-Blog's
 * publication code, from the moment it is created: on the post's publish date,
 * with the Mini-Blog's medium (Email, SMS, Push Notification…) as the issue type.
 * Status follows the post: Drafting (draft or waiting for approval) → Scheduled
 * (published, future time) → Sent (live; the miniblog.calendar-status job flips it
 * when a scheduled post goes live). It runs on create and on every save, and the
 * issue id is kept on the post, so re-saving updates the same issue.
 */
export async function syncPostToCalendar(input: { organizationId: string; postId: string; actorId: string | null; publicUrl: string }): Promise<CalendarSync> {
  const db = tenantDb(input.organizationId);
  const post = await db.textPost.findFirst({ where: { id: input.postId, deletedAt: null } });
  if (!post) return "skipped";
  const site = await db.textSite.findFirst({ where: { id: post.siteId, deletedAt: null } });
  const code = site?.calendarCode?.trim();
  if (!site || !code) return "skipped";
  const publication = await db.calendarPublication.findFirst({ where: { brandId: site.brandId, code } });
  if (!publication) return "skipped";
  const timeZone = await orgTimezone(input.organizationId);
  const status = calendarStatusFor(post.publishAt, new Date(), post.status);
  const when = formatZoned(post.publishAt, timeZone, { weekday: false });
  const data = {
    publicationCode: code,
    mailDate: new Date(`${zonedDayKey(post.publishAt, timeZone)}T00:00:00Z`),
    title: post.title,
    status,
    issueType: site.medium,
    tickers: parseTickers(post.tickers),
    notes: [`${site.medium} Mini-Blog post on ${site.name}, publishes ${when}.`, post.category ? `Category: ${post.category}.` : "", excerpt(stripContentAd(post.bodyHtml), 240)].filter(Boolean).join(" ").trim(),
    websiteLink: input.publicUrl,
    ctaLink: post.buttonUrl && /^https?:\/\//i.test(post.buttonUrl) ? post.buttonUrl : null,
    updatedById: input.actorId,
  };
  if (post.calendarIssueId) {
    const updated = await db.calendarIssue.updateMany({ where: { id: post.calendarIssueId, deletedAt: null }, data });
    if (updated.count) return "updated";
  }
  const issue = await db.calendarIssue.create({
    data: { organizationId: input.organizationId, brandId: site.brandId, ...data, createdById: input.actorId },
    select: { id: true },
  });
  await db.textPost.updateMany({ where: { id: post.id }, data: { calendarIssueId: issue.id } });
  await appendOrgAudit(input.organizationId, { actorId: input.actorId, action: "calendar.issue.created", targetType: "calendar_issue", targetId: issue.id, metadata: { from: "tletter-post", postId: post.id } });
  return "created";
}

/**
 * A deleted post takes its Calendar issue with it, unless the issue is already
 * Sent (a post that went out stays on the calendar as a record). Restoring the
 * post re-creates it on the next sync.
 */
export async function removePostFromCalendar(organizationId: string, postId: string, actorId: string | null): Promise<boolean> {
  const db = tenantDb(organizationId);
  const post = await db.textPost.findFirst({ where: { id: postId }, select: { calendarIssueId: true } });
  if (!post?.calendarIssueId) return false;
  const removed = await db.calendarIssue.updateMany({ where: { id: post.calendarIssueId, deletedAt: null, status: { not: "Sent" } }, data: { deletedAt: new Date(), updatedById: actorId } });
  if (removed.count) await appendOrgAudit(organizationId, { actorId, action: "calendar.issue.deleted", targetType: "calendar_issue", targetId: post.calendarIssueId, metadata: { from: "tletter-post", postId } });
  return removed.count > 0;
}
