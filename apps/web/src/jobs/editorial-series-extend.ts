import { rawPrisma } from "@pubcommand/db";
import { defineJob } from "@/lib/jobs/types";
import { todayIn } from "../../../../modules/editorial/dates";
import { EXTEND_MONTHS } from "../../../../modules/editorial/recurrence";
import { extendOpenSeries } from "@/features/calendar/events";

/** Keeps open-ended recurring series planned six months ahead. */
export const editorialSeriesExtend = defineJob({
  name: "editorial.series-extend",
  description: `Plan open-ended recurring events ${EXTEND_MONTHS} months ahead.`,
  schedule: "17 3 * * *",
  async run() {
    const orgs = await rawPrisma().organization.findMany({ where: { suspendedAt: null }, select: { id: true } });
    const today = todayIn();
    let series = 0;
    let created = 0;
    for (const { id } of orgs) {
      const result = await extendOpenSeries(id, today);
      series += result.series;
      created += result.created;
    }
    return { organizations: orgs.length, series, created };
  },
});
