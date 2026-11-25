import { platformTx, rawPrisma } from "@pubcommand/db";
import { MAX_IDLE_TIMEOUT_MINUTES } from "@pubcommand/core";
import { defineJob } from "@/lib/jobs/types";

const DAY = 86_400_000;

/** Keeps usage tables small: server samples 30 days, activities and sign-ins 400 days. Daily totals are kept. */
export const usageCleanup = defineJob({
  name: "usage.cleanup",
  description: "Remove old usage rows (server samples after 30 days, activities and sign-ins after 400) and long-idle sessions.",
  schedule: "25 4 * * *",
  async run() {
    const now = Date.now();
    const result = await platformTx(async (tx) => ({
      samples: (await tx.usageServerSample.deleteMany({ where: { createdAt: { lt: new Date(now - 30 * DAY) } } })).count,
      activities: (await tx.usageActivity.deleteMany({ where: { createdAt: { lt: new Date(now - 400 * DAY) } } })).count,
      logins: (await tx.usageLogin.deleteMany({ where: { createdAt: { lt: new Date(now - 400 * DAY) } } })).count,
    }));
    // Sessions idle longer than the longest timeout can never be used again.
    const sessions = await rawPrisma().session.deleteMany({
      where: { OR: [{ expiresAt: { lt: new Date(now) } }, { lastActiveAt: { lt: new Date(now - MAX_IDLE_TIMEOUT_MINUTES * 60_000) } }] },
    });
    return { ...result, sessions: sessions.count };
  },
});
