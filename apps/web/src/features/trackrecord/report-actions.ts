"use server";

import { tenantDb } from "@pubcommand/db";
import { redirect } from "next/navigation";
import { trackAccess } from "./context";
import { buildWeeklyReport, saveReportSettings, sendWeeklyReport } from "./reports";

function go(message: { error?: string; notice?: string }): never {
  const query = message.error ? `?error=${encodeURIComponent(message.error)}` : message.notice ? `?notice=${encodeURIComponent(message.notice)}` : "";
  redirect(`/performance/reports${query}`);
}

async function writer() {
  const access = await trackAccess("performance.write");
  if (!access.ok) go({ error: access.error });
  return access.scope;
}

export async function updateReportSettings(formData: FormData) {
  const scope = await writer();
  await saveReportSettings(scope, {
    enabled: formData.get("enabled") === "on",
    autoSend: formData.get("autoSend") === "on",
    recipientIds: formData.getAll("recipientIds").map(String).filter((id) => /^[0-9a-f-]{36}$/i.test(id)),
  });
  go({ notice: "Weekly report settings saved." });
}

/** Build this week's report now (a draft; nothing is sent). */
export async function buildReportNow() {
  const scope = await writer();
  const report = await buildWeeklyReport(scope, { brandName: scope.brandName, orgSlug: scope.slug });
  go({ notice: report.status === "SENT" ? `This week's report (${report.week}) was already sent; it is kept as sent.` : `This week's report (${report.week}) is ready to review.` });
}

export async function sendReportNow(formData: FormData) {
  const scope = await writer();
  const id = String(formData.get("reportId") ?? "");
  const report = /^[0-9a-f-]{36}$/i.test(id) ? await tenantDb(scope.organizationId).trackWeeklyReport.findFirst({ where: { id, brandId: scope.brandId } }) : null;
  if (!report) go({ error: "That report no longer exists." });
  if (report.status === "SENT") go({ error: "That report was already sent." });
  const result = await sendWeeklyReport(scope, report);
  if (result.status === "NO_RECIPIENTS") go({ error: "Pick at least one team member to send it to." });
  if (result.status === "LOGGED") go({ error: "Email is not set up yet (RESEND_API_KEY), so nothing was sent. The report is saved." });
  if (result.status === "FAILED") go({ error: `The email could not be sent: ${result.reason ?? "unknown error"}` });
  go({ notice: `Sent to ${result.sent} team member${result.sent === 1 ? "" : "s"}.` });
}
