import { buildSiteUrl } from "@pubcommand/core";
import { tenantDb } from "@pubcommand/db";
import { sendEmail, type EmailResult } from "@/lib/email";
import { weeklyReport } from "../../../../../modules/performance/report";
import { isoWeek } from "../../../../../modules/performance/stats";
import { auditTrack, listPortfolios, positionViews, toStat, type TrackWorkScope } from "./server";

type Db = ReturnType<typeof tenantDb>;
export type ReportRow = Awaited<ReturnType<Db["trackWeeklyReport"]["findMany"]>>[number];
export type ReportSettingsRow = Awaited<ReturnType<Db["trackReportSettings"]["findMany"]>>[number];

export type TeamMember = { userId: string; name: string; email: string };

/** Active members of the organization: the only people the weekly report can go to. */
export async function teamMembers(organizationId: string): Promise<TeamMember[]> {
  const rows = await tenantDb(organizationId).membership.findMany({
    where: { status: "ACTIVE", user: { disabledAt: null } },
    select: { userId: true, user: { select: { name: true, email: true } } },
  });
  const byUser = new Map<string, TeamMember>();
  for (const row of rows) byUser.set(row.userId, { userId: row.userId, name: row.user.name || row.user.email, email: row.user.email });
  return [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function reportSettings(scope: Pick<TrackWorkScope, "organizationId" | "brandId">): Promise<ReportSettingsRow | null> {
  return tenantDb(scope.organizationId).trackReportSettings.findFirst({ where: { brandId: scope.brandId } });
}

export async function saveReportSettings(scope: TrackWorkScope, input: { enabled: boolean; autoSend: boolean; recipientIds: string[] }) {
  const db = tenantDb(scope.organizationId);
  const members = new Set((await teamMembers(scope.organizationId)).map((m) => m.userId));
  const recipientIds = [...new Set(input.recipientIds)].filter((id) => members.has(id)).slice(0, 100);
  const existing = await reportSettings(scope);
  const data = { enabled: input.enabled, autoSend: input.autoSend, recipientIds, updatedById: scope.actorId };
  if (existing) await db.trackReportSettings.updateMany({ where: { id: existing.id }, data });
  else await db.trackReportSettings.create({ data: { organizationId: scope.organizationId, brandId: scope.brandId, ...data } });
  await auditTrack(scope, "trackrecord.report.settings", "track_report_settings", existing?.id ?? scope.brandId, { enabled: input.enabled, autoSend: input.autoSend, recipients: recipientIds.length });
}

function appUrl(orgSlug: string): string {
  const root = process.env.ROOT_DOMAIN ?? "localhost";
  return buildSiteUrl({ rootDomain: root, requestHost: root, site: { kind: "org", slug: orgSlug }, pathname: "/performance" });
}

/**
 * Build (or rebuild) this week's report for one brand. A report that was already sent is never rebuilt, so a
 * re-run of the job cannot change what people received.
 */
export async function buildWeeklyReport(scope: TrackWorkScope, input: { brandName: string; orgSlug: string; today?: Date }): Promise<ReportRow> {
  const db = tenantDb(scope.organizationId);
  const today = input.today ?? new Date();
  const week = isoWeek(today);
  const existing = await db.trackWeeklyReport.findFirst({ where: { brandId: scope.brandId, week } });
  if (existing && existing.status === "SENT") return existing;
  const portfolios = await listPortfolios(scope);
  const views = await positionViews(scope.organizationId, { brandId: scope.brandId }, { refresh: true });
  const report = weeklyReport({
    brandName: input.brandName,
    portfolios: portfolios.map((p) => ({ name: p.name, publication: p.publication, positions: views.filter((v) => v.portfolioId === p.id).map(toStat) })),
    today,
    appUrl: appUrl(input.orgSlug),
  });
  const data = { subject: report.subject, html: report.html, text: report.text };
  if (existing) {
    await db.trackWeeklyReport.updateMany({ where: { id: existing.id }, data: { ...data, status: existing.status === "FAILED" ? "FAILED" : "DRAFT" } });
    return { ...existing, ...data };
  }
  return db.trackWeeklyReport.create({ data: { organizationId: scope.organizationId, brandId: scope.brandId, week, ...data } });
}

/** Send a report to the chosen team members, one email each (recipients never see each other). */
export async function sendWeeklyReport(scope: TrackWorkScope, report: ReportRow): Promise<{ status: "SENT" | "LOGGED" | "FAILED" | "NO_RECIPIENTS"; sent: number; reason?: string }> {
  const db = tenantDb(scope.organizationId);
  const settings = await reportSettings(scope);
  const members = await teamMembers(scope.organizationId);
  const chosen = new Set(settings?.recipientIds ?? []);
  const recipients = members.filter((m) => chosen.has(m.userId));
  if (!recipients.length) return { status: "NO_RECIPIENTS", sent: 0 };
  let sent = 0;
  let logged = 0;
  let lastError: string | null = null;
  for (const member of recipients) {
    const result: EmailResult = await sendEmail({ to: member.email, subject: report.subject, html: report.html, text: report.text });
    if (result.status === "sent") sent += 1;
    else if (result.status === "logged") logged += 1;
    else lastError = result.reason;
  }
  const status = sent > 0 ? "SENT" : logged > 0 ? "LOGGED" : "FAILED";
  await db.trackWeeklyReport.updateMany({
    where: { id: report.id },
    data: { status, sentAt: status === "SENT" ? new Date() : null, sentCount: sent, error: lastError },
  });
  await auditTrack(scope, "trackrecord.report.sent", "track_weekly_report", report.id, { status, sent, recipients: recipients.length });
  return { status, sent, ...(lastError ? { reason: lastError } : {}) };
}

export async function recentReports(scope: Pick<TrackWorkScope, "organizationId" | "brandId">, take = 8): Promise<ReportRow[]> {
  return tenantDb(scope.organizationId).trackWeeklyReport.findMany({ where: { brandId: scope.brandId }, orderBy: { createdAt: "desc" }, take });
}
