import { appendOrgAudit, rawPrisma, tenantDb } from "@pubcommand/db";
import { defineJob } from "@/lib/jobs/types";
import { rowToField, asLayout } from "@/features/forms/data";
import { scheduleActions } from "../../../../modules/forms/jobs";
import { cleanEndRules } from "../../../../modules/forms/logic";
import { publishProblems } from "../../../../modules/forms/theme";

/** Publishes drafts set to open on a schedule and closes forms past their closing time or response cap. */
export const formsSchedule = defineJob({
  name: "forms.schedule",
  description: "Open scheduled forms and close forms past their closing time or response limit.",
  schedule: "*/5 * * * *",
  async run() {
    const orgs = await rawPrisma().organization.findMany({ select: { id: true } });
    const now = new Date();
    let published = 0;
    let closed = 0;
    let blocked = 0;
    for (const org of orgs) {
      const db = tenantDb(org.id);
      const rows = await db.form.findMany({
        where: {
          deletedAt: null,
          OR: [
            { status: "DRAFT", autoPublish: true, opensAt: { lte: now } },
            { status: "OPEN", closesAt: { lte: now } },
            { status: "OPEN", responseLimit: { not: null } },
          ],
        },
        select: { id: true, status: true, opensAt: true, closesAt: true, autoPublish: true, responseLimit: true, publishedAt: true },
      });
      if (!rows.length) continue;
      const counts = new Map<string, number>();
      for (const row of rows.filter((item) => item.status === "OPEN" && item.responseLimit)) {
        counts.set(row.id, await db.formResponse.count({ where: { formId: row.id, status: "COMPLETE", spamReason: null } }));
      }
      for (const action of scheduleActions(rows, counts, now)) {
        if (action.action === "close") {
          // Conditional on the status, so a form someone reopened a moment ago is not closed by a stale read.
          const result = await db.form.updateMany({ where: { id: action.id, status: "OPEN" }, data: { status: "CLOSED" } });
          if (result.count) {
            closed += 1;
            await appendOrgAudit(org.id, { actorId: null, action: `forms.form.closed.${action.reason}`, targetType: "form", targetId: action.id });
          }
          continue;
        }
        const form = await db.form.findFirst({ where: { id: action.id } });
        if (!form) continue;
        const theme = form.themeId ? await db.formTheme.findFirst({ where: { id: form.themeId, deletedAt: null } }) : null;
        const fields = (await db.formField.findMany({ where: { formId: form.id }, orderBy: { position: "asc" } })).map(rowToField);
        const problems = publishProblems({ title: form.title, slug: form.slug, fields, layout: asLayout(form.layout), theme, endRules: cleanEndRules(fields, form.endRules) });
        if (problems.length) {
          // Stop trying until someone fixes and saves it; the reason is shown on the form.
          await db.form.updateMany({ where: { id: form.id }, data: { autoPublish: false, scheduleNote: problems[0]!.slice(0, 300) } });
          blocked += 1;
          continue;
        }
        const result = await db.form.updateMany({
          where: { id: form.id, status: "DRAFT", autoPublish: true },
          data: { status: "OPEN", autoPublish: false, scheduleNote: null, ...(form.publishedAt ? {} : { publishedAt: now }) },
        });
        if (result.count) {
          published += 1;
          await appendOrgAudit(org.id, { actorId: null, action: "forms.form.open.scheduled", targetType: "form", targetId: form.id });
        }
      }
    }
    return { published, closed, blocked };
  },
});
