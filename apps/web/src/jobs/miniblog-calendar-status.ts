import { appendOrgAudit, rawPrisma, tenantDb } from "@pubcommand/db";
import { defineJob } from "@/lib/jobs/types";
import { shouldFlipToSent } from "../../../../modules/miniblog/site";

/**
 * When a scheduled Mini-Blog post goes live, its Marketing Calendar issue moves
 * from "Scheduled" to "Sent". Idempotent: only issues still marked Scheduled
 * are touched, and an issue someone moved to another status by hand is left alone.
 */
export const miniblogCalendarStatus = defineJob({
  name: "miniblog.calendar-status",
  description: "Mark Marketing Calendar issues Sent when their scheduled Mini-Blog post goes live.",
  schedule: "*/5 * * * *",
  async run() {
    const now = new Date();
    const orgs = await rawPrisma().organization.findMany({ where: { suspendedAt: null }, select: { id: true } });
    let checked = 0;
    let flipped = 0;
    for (const { id: organizationId } of orgs) {
      const db = tenantDb(organizationId);
      const posts = await db.textPost.findMany({
        where: { status: "published", deletedAt: null, publishAt: { lte: now }, calendarIssueId: { not: null } },
        select: { id: true, status: true, publishAt: true, deletedAt: true, calendarIssueId: true },
        take: 2000,
      });
      if (!posts.length) continue;
      const issues = await db.calendarIssue.findMany({ where: { id: { in: posts.map((post) => post.calendarIssueId!) }, status: "Scheduled", deletedAt: null }, select: { id: true, status: true } });
      const byId = new Map(issues.map((issue) => [issue.id, issue]));
      for (const post of posts) {
        const issue = byId.get(post.calendarIssueId!);
        if (!issue) continue;
        checked += 1;
        if (!shouldFlipToSent(issue.status, post, now)) continue;
        const updated = await db.calendarIssue.updateMany({ where: { id: issue.id, status: "Scheduled" }, data: { status: "Sent" } });
        if (updated.count) {
          flipped += 1;
          await appendOrgAudit(organizationId, { actorId: null, action: "calendar.issue.updated", targetType: "calendar_issue", targetId: issue.id, metadata: { from: "miniblog-post-live", postId: post.id, status: "Sent" } });
        }
      }
    }
    return { organizations: orgs.length, checked, flipped };
  },
});
