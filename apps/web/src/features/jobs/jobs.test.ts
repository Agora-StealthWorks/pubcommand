import { randomBytes } from "node:crypto";
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rawPrisma } from "@pubcommand/db";
import { lastSlot, nextSlot, slotIsDue } from "@/lib/jobs/schedule";
import { tick } from "@/lib/jobs/runner";
import { defineJob } from "@/lib/jobs/types";

describe("job schedules", () => {
  it("finds the last and next slot in New York time", () => {
    const now = new Date("2026-11-17T15:10:00Z"); // 10:10 New York
    expect(lastSlot("0 9 * * *", now)?.toISOString()).toBe("2026-11-17T14:00:00.000Z");
    expect(nextSlot("0 9 * * *", now)?.toISOString()).toBe("2026-11-18T14:00:00.000Z");
    expect(lastSlot("*/15 * * * *", now)?.toISOString()).toBe("2026-11-17T15:00:00.000Z");
  });
  it("counts a slot that is exactly now", () => {
    const now = new Date("2026-11-17T15:00:00Z");
    expect(lastSlot("0 * * * *", now)?.toISOString()).toBe("2026-11-17T15:00:00.000Z");
  });
  it("rejects bad expressions and skips old missed slots", () => {
    expect(lastSlot("not a cron", new Date())).toBeNull();
    const now = new Date("2026-11-17T15:00:00Z");
    expect(slotIsDue(new Date("2026-11-17T14:59:00Z"), now)).toBe(true);
    expect(slotIsDue(new Date("2026-11-16T15:00:00Z"), now)).toBe(false);
  });
  it("refuses bad job names", () => {
    expect(() => defineJob({ name: "Bad Name", description: "", schedule: "* * * * *", run: async () => undefined })).toThrow();
  });
});

describe("job runner", () => {
  const name = `test.job-${randomBytes(3).toString("hex")}`;
  let runs = 0;
  const job = defineJob({ name, description: "test", schedule: "*/5 * * * *", run: async () => { runs += 1; return { ok: 1 }; } });

  beforeAll(() => {
    execSync("pnpm exec prisma migrate deploy --schema prisma/schema", {
      cwd: new URL("../../../../../packages/db", import.meta.url).pathname,
      env: process.env,
      stdio: "ignore",
    });
  });
  afterAll(async () => {
    await rawPrisma().jobRun.deleteMany({ where: { job: name } });
  });

  it("runs a slot once even when two servers tick together", async () => {
    const now = new Date("2026-11-17T15:06:00Z");
    const [a, b] = await Promise.all([tick(now, [job]), tick(now, [job])]);
    expect([...a, ...b]).toEqual([name]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(runs).toBe(1);
    const rows = await rawPrisma().jobRun.findMany({ where: { job: name } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("succeeded");
    expect(rows[0]?.scheduledFor.toISOString()).toBe("2026-11-17T15:05:00.000Z");
    expect(await tick(now, [job])).toEqual([]);
  });
});
