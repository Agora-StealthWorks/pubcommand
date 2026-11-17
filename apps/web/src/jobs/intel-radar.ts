import { defineJob } from "@/lib/jobs/types";
import { buildAllRadars, lastCompleteWeek, narrateAll } from "@/features/intel/scheduled";
import { isoDay } from "../../../../modules/intel/index";

/** Monday morning: build last week's Promo Radar (and its AI read) for every brand that got competitor mail. */
export const intelRadar = defineJob({
  name: "intel.radar",
  description: "Build last week's Promo Radar for every brand that received competitor email.",
  schedule: "10 6 * * 1",
  timeoutMs: 30 * 60_000,
  async run() {
    const week = lastCompleteWeek();
    const built = await buildAllRadars(week);
    await narrateAll(built);
    return { week: isoDay(week), brands: built.length };
  },
});
