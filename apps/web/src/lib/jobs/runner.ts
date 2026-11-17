import { Prisma, rawPrisma } from "@pubcommand/db";
import { JOBS } from "@/jobs";
import { lastSlot, slotIsDue } from "./schedule";
import type { JobDefinition } from "./types";

const TICK_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 15 * 60_000;
let started = false;
const inFlight = new Set<string>();

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000);
}

/** Claims a slot by inserting its row. Only one server wins the unique (job, slot). */
async function claim(job: JobDefinition, scheduledFor: Date, trigger: "schedule" | "manual", actorId: string | null) {
  try {
    return await rawPrisma().jobRun.create({ data: { job: job.name, scheduledFor, trigger, actorId } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null;
    throw error;
  }
}

async function execute(job: JobDefinition, runId: string, scheduledFor: Date, trigger: "schedule" | "manual") {
  const started = Date.now();
  const lines: string[] = [];
  inFlight.add(job.name);
  try {
    const timeout = job.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const result = await Promise.race([
      job.run({ scheduledFor, trigger, log: (message) => lines.length < 50 && lines.push(message.slice(0, 500)) }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${Math.round(timeout / 1000)}s`)), timeout)),
    ]);
    await rawPrisma().jobRun.update({
      where: { id: runId },
      data: {
        status: "succeeded",
        finishedAt: new Date(),
        durationMs: Date.now() - started,
        details: { ...(result ?? {}), ...(lines.length ? { log: lines } : {}) } as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    console.error(`[jobs] ${job.name} failed`, error);
    await rawPrisma()
      .jobRun.update({
        where: { id: runId },
        data: { status: "failed", finishedAt: new Date(), durationMs: Date.now() - started, error: errorText(error), details: lines.length ? { log: lines } : undefined },
      })
      .catch(() => undefined);
  } finally {
    inFlight.delete(job.name);
  }
}

/** One pass: run every job whose latest slot has no run yet. Exported for tests. */
export async function tick(now = new Date(), jobs: JobDefinition[] = JOBS): Promise<string[]> {
  const ran: string[] = [];
  for (const job of jobs) {
    if (inFlight.has(job.name)) continue;
    const slot = lastSlot(job.schedule, now, job.timeZone);
    if (!slot || !slotIsDue(slot, now)) continue;
    const run = await claim(job, slot, "schedule", null);
    if (!run) continue;
    ran.push(job.name);
    void execute(job, run.id, slot, "schedule");
  }
  return ran;
}

/** Runs a job now (Admin → Jobs → Run now). */
export async function runJobNow(name: string, actorId: string | null): Promise<{ ok: boolean; reason?: string }> {
  const job = JOBS.find((item) => item.name === name);
  if (!job) return { ok: false, reason: "Unknown job." };
  if (inFlight.has(job.name)) return { ok: false, reason: "It is already running." };
  const now = new Date();
  const run = await claim(job, now, "manual", actorId);
  if (!run) return { ok: false, reason: "It is already running." };
  void execute(job, run.id, now, "manual");
  return { ok: true };
}

/** Marks runs left "running" by a restarted server as failed. */
async function reapStale() {
  const cutoff = new Date(Date.now() - DEFAULT_TIMEOUT_MS - 5 * 60_000);
  await rawPrisma()
    .jobRun.updateMany({ where: { status: "running", startedAt: { lt: cutoff } }, data: { status: "failed", finishedAt: new Date(), error: "Interrupted (the server restarted)." } })
    .catch(() => undefined);
}

/** Starts the minute ticker once per server process. Set JOBS_ENABLED=false to turn it off. */
export function startJobRunner() {
  if (started || process.env.JOBS_ENABLED === "false") return;
  started = true;
  const loop = async () => {
    try {
      await reapStale();
      await tick();
    } catch (error) {
      console.error("[jobs] tick failed", error);
    }
  };
  setTimeout(loop, 15_000);
  setInterval(loop, TICK_MS).unref?.();
  console.info(`[jobs] runner started with ${JOBS.length} job(s)`);
}
