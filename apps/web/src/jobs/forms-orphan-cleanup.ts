import { rawPrisma, tenantDb } from "@pubcommand/db";
import { defineJob } from "@/lib/jobs/types";
import { orphanFiles } from "../../../../modules/forms/jobs";

/** Deletes form files nothing points at: respondent uploads with no response, and logos no theme uses. */
export const formsOrphanCleanup = defineJob({
  name: "forms.orphan-cleanup",
  description: "Delete form uploads and logos that no response or theme uses (older than a day).",
  schedule: "40 3 * * *",
  async run() {
    const orgs = await rawPrisma().organization.findMany({ where: { deletedAt: null }, select: { id: true } });
    let deleted = 0;
    const now = new Date();
    for (const org of orgs) {
      const db = tenantDb(org.id);
      const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      // Metadata only: the bytes are never loaded.
      const files = await db.formFile.findMany({
        where: { createdAt: { lt: cutoff }, OR: [{ kind: "logo" }, { responseId: null }] },
        select: { id: true, kind: true, responseId: true, createdAt: true },
        take: 5000,
      });
      if (!files.length) continue;
      const themes = await db.formTheme.findMany({ where: { logoFileId: { not: null } }, select: { logoFileId: true } });
      const ids = orphanFiles(files, new Set(themes.map((theme) => theme.logoFileId!)), now);
      if (!ids.length) continue;
      const result = await db.formFile.deleteMany({ where: { id: { in: ids } } });
      deleted += result.count;
    }
    return { organizations: orgs.length, deleted };
  },
});
