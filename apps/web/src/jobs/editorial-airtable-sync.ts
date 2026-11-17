import { rawPrisma, tenantDb } from "@pubcommand/db";
import { defineJob } from "@/lib/jobs/types";
import { syncConnection } from "@/features/calendar/airtable-sync";

/** Optional two-way Airtable sync: pull each connected brand's base, then push local edits. */
export const editorialAirtableSync = defineJob({
  name: "editorial.airtable-sync",
  description: "Pull connected Airtable bases into the Marketing Calendar and push local edits back.",
  schedule: "23 * * * *",
  timeoutMs: 30 * 60 * 1000,
  async run() {
    const orgs = await rawPrisma().organization.findMany({ where: { suspendedAt: null }, select: { id: true } });
    const total = { connections: 0, created: 0, updated: 0, pushed: 0, failed: 0 };
    for (const { id } of orgs) {
      const connections = await tenantDb(id).calendarAirtableConnection.findMany({ where: { enabled: true } });
      for (const conn of connections) {
        total.connections += 1;
        const result = await syncConnection(conn);
        if ("error" in result) total.failed += 1;
        else {
          total.created += result.events.created + result.issues.created;
          total.updated += result.events.updated + result.issues.updated;
          total.pushed += result.pushed;
        }
      }
    }
    return total;
  },
});
