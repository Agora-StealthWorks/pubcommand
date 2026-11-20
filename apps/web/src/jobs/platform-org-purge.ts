import { organizationsDueForPurge, purgeOrganization } from "@pubcommand/db";
import { detachDomainsFromRailway } from "@/features/platform-admin/domains";
import { defineJob } from "@/lib/jobs/types";

/** Permanently removes organizations that were deleted more than 30 days ago. */
export const platformOrgPurge = defineJob({
  name: "platform.org-purge",
  description: "Permanently delete organizations that were deleted more than 30 days ago (detaches their custom domains from Railway).",
  schedule: "40 3 * * *",
  async run() {
    let purged = 0;
    let failed = 0;
    let domainsNotDetached = 0;
    for (const organizationId of await organizationsDueForPurge()) {
      try {
        const result = await purgeOrganization({ organizationId, actorId: null, confirm: null, detachDomains: (rows) => detachDomainsFromRailway(rows) });
        purged += 1;
        domainsNotDetached += result.domains.filter((row) => !row.ok).length;
      } catch (error) {
        failed += 1;
        console.error(JSON.stringify({ msg: "org purge failed", organizationId, error: error instanceof Error ? error.message : String(error) }));
      }
    }
    return { purged, failed, domainsNotDetached };
  },
});
