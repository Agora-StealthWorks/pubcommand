import { appendOrgAudit, tenantDb } from "@pubcommand/db";
import { excerpt } from "../../../../../modules/miniblog/site";
import { zonedDayKey } from "../../../../../modules/miniblog/time";
import { orgTimezone } from "./data";

export type CalendarSync = "created" | "updated" | "skipped";

/**
 * A published (or scheduled) Mini-Blog post becomes one Marketing Calendar
 * issue under the Mini-Blog's publication code. It runs on every save, not only when
 * the post goes live, so a post written ahead of its date is never missed. The
 * issue id is kept on the post, so re-saving updates the same issue.
 */
export async function syncPostToCalendar(input: { organizationId: string; postId: string; actorId: string | null; publicUrl: string }): Promise<CalendarSync> {
  const db = tenantDb(input.organizationId);
  const post = await db.textPost.findFirst({ where: { id: input.postId, deletedAt: null } });
  if (!post || post.status !== "published") return "skipped";
  const site = await db.textSite.findFirst({ where: { id: post.siteId, deletedAt: null } });
  const code = site?.calendarCode?.trim();
  if (!site || !code) return "skipped";
  const publication = await db.calendarPublication.findFirst({ where: { brandId: site.brandId, code } });
  if (!publication) return "skipped";
  const timeZone = await orgTimezone(input.organizationId);
  const data = {
    publicationCode: code,
    mailDate: new Date(`${zonedDayKey(post.publishAt, timeZone)}T00:00:00Z`),
    title: post.title,
    status: post.publishAt > new Date() ? "Scheduled" : "Sent",
    notes: `Mini-Blog post on ${site.name}. ${excerpt(post.bodyHtml, 240)}`.trim(),
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
