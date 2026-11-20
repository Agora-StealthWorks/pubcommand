import { rawPrisma, tenantDb } from "@pubcommand/db";
import { defineJob } from "@/lib/jobs/types";
import { mirrorResponse } from "@/features/forms/mirror";
import { MIRROR_MAX_ATTEMPTS, mirrorDue } from "../../../../modules/forms/mirror";

/** Retries copies to authors' Airtable tables / Google Sheets that failed or never ran, on a backoff. */
export const formsMirrorRetry = defineJob({
  name: "forms.mirror-retry",
  description: "Retry failed copies of form responses to Airtable or Google Sheets.",
  schedule: "*/15 * * * *",
  async run() {
    const orgs = await rawPrisma().organization.findMany({ where: { deletedAt: null }, select: { id: true } });
    const now = new Date();
    let ok = 0;
    let failed = 0;
    for (const org of orgs) {
      const db = tenantDb(org.id);
      const rows = await db.formResponse.findMany({
        where: { mirrorStatus: { in: ["pending", "failed"] }, mirrorAttempts: { lt: MIRROR_MAX_ATTEMPTS } },
        select: { id: true, status: true, spamReason: true, mirrorStatus: true, mirrorAttempts: true, mirrorTriedAt: true },
        orderBy: { mirrorTriedAt: "asc" },
        take: 200,
      });
      for (const id of mirrorDue(rows, now).slice(0, 100)) {
        const result = await mirrorResponse(org.id, id);
        if (result === "ok") ok += 1;
        if (result === "failed") failed += 1;
      }
    }
    return { copied: ok, failed };
  },
});
