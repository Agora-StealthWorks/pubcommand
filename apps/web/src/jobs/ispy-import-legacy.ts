import type { Prisma } from "@pubcommand/db";
import { defineJob } from "@/lib/jobs/types";
import { ispyDb } from "@/features/ispy/db";
import { importLegacyIspy } from "@/features/ispy/import-legacy";

/** Idle unless staff pressed Import (or Dry run) in Admin → ISpy → Import. */
export const ispyImportLegacy = defineJob({
  name: "ispy.import-legacy",
  description: "Import the old iSpy database when staff ask for it in the console (idle otherwise).",
  schedule: "*/5 * * * *",
  timeoutMs: 110 * 60_000,
  async run({ log }) {
    const request = await ispyDb((tx) => tx.ispySetting.findUnique({ where: { key: "import_request" } }));
    if (!request) return { idle: true };
    await ispyDb((tx) => tx.ispySetting.delete({ where: { key: "import_request" } }));
    const apply = (request.value as { apply?: boolean }).apply === true;
    await ispyDb((tx) => tx.ispySetting.upsert({ where: { key: "import_report" }, create: { key: "import_report", value: { running: true, dryRun: !apply, startedAt: new Date().toISOString() } }, update: { value: { running: true, dryRun: !apply, startedAt: new Date().toISOString() } } }));
    const report = await importLegacyIspy({ dryRun: !apply, log });
    await ispyDb((tx) => tx.ispySetting.update({ where: { key: "import_report" }, data: { value: report as unknown as Prisma.InputJsonValue } }));
    return { dryRun: report.dryRun, error: report.error ?? null, emails: report.counts.emails?.added ?? 0 };
  },
});
