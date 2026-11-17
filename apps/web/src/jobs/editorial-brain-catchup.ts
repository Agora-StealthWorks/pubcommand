import { rawPrisma } from "@pubcommand/db";
import { defineJob } from "@/lib/jobs/types";
import { teachPending } from "@/features/calendar/teach";

/**
 * Teaches the brand Brain about every calendar issue and event saved outside the
 * calendar's own forms (Mini-Blog posts, other jobs, Airtable pulls). Idempotent.
 */
export const editorialBrainCatchup = defineJob({
  name: "editorial.brain-catchup",
  description: "Teach the brand Brain about calendar issues and events saved since they were last taught.",
  schedule: "*/15 * * * *",
  async run() {
    const orgs = await rawPrisma().organization.findMany({ where: { suspendedAt: null }, select: { id: true } });
    let issues = 0;
    let events = 0;
    for (const { id } of orgs) {
      const result = await teachPending(id);
      issues += result.issues;
      events += result.events;
    }
    return { organizations: orgs.length, issues, events };
  },
});
