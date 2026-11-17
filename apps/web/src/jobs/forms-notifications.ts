import { rawPrisma, tenantDb } from "@pubcommand/db";
import { defineJob } from "@/lib/jobs/types";
import { notifyTeam } from "@/features/forms/notify";
import { asNotifyMode, pendingNotifications } from "../../../../modules/forms/notify";

/** Sends daily digests of new responses and retries per-response emails that did not go out. */
export const formsNotifications = defineJob({
  name: "forms.notification-digest",
  description: "Email daily digests of new form responses and retry missed per-response emails.",
  schedule: "7 * * * *",
  async run() {
    const orgs = await rawPrisma().organization.findMany({ select: { id: true } });
    const now = new Date();
    let forms = 0;
    let sent = 0;
    let failed = 0;
    for (const org of orgs) {
      const db = tenantDb(org.id);
      const rows = await db.form.findMany({
        where: { deletedAt: null, notifyMode: { in: ["each", "digest"] } },
        select: { id: true, notifyMode: true, notifyUserIds: true, notifyDigestSentAt: true },
      });
      for (const form of rows) {
        const pending = await db.formResponse.findMany({
          where: { formId: form.id, status: "COMPLETE", spamReason: null, notifiedAt: null },
          select: { id: true, status: true, completedAt: true, spamReason: true, notifiedAt: true },
          orderBy: { completedAt: "asc" },
          take: 500,
        });
        const ids = pendingNotifications({ mode: asNotifyMode(form.notifyMode), recipients: form.notifyUserIds.length, lastDigestAt: form.notifyDigestSentAt, now, rows: pending });
        if (!ids.length) continue;
        forms += 1;
        const outcome = await notifyTeam(org.id, form.id, ids, now);
        sent += outcome.sent;
        failed += outcome.failed;
      }
    }
    return { forms, responsesNotified: sent, failed };
  },
});
