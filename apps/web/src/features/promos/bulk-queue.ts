import { rawPrisma, tenantDb } from "@pubcommand/db";
import { BULK_CONCURRENCY, pickClaims, planRecovery } from "../../../../../modules/promo-studio/queue";

/**
 * The durable bulk re-analysis queue (promo_bulk_jobs). Rows survive restarts;
 * the `promo-studio.bulk-reanalyze` job drains them every minute, and a new
 * batch kicks a drain straight away. At most BULK_CONCURRENCY run at once
 * across every server: claims happen under one Postgres advisory lock.
 */

/** Any 64-bit number unique to this queue. */
const LOCK_KEY = 7_311_204_118;

export type ClaimedJob = { id: string; organizationId: string; brandId: string; promoId: string; actorId: string | null; attempts: number };

/** Add promos to the queue. Promos already waiting or running are skipped. */
export async function enqueueBulk(input: { organizationId: string; brandId: string; promoIds: readonly string[]; actorId: string | null }): Promise<string[]> {
  const db = tenantDb(input.organizationId);
  const busy = await db.promoBulkJob.findMany({ where: { promoId: { in: [...input.promoIds] }, status: { in: ["QUEUED", "RUNNING"] } }, select: { promoId: true } });
  const skip = new Set(busy.map((row) => row.promoId));
  const added: string[] = [];
  for (const promoId of input.promoIds) {
    if (skip.has(promoId)) continue;
    await db.promoBulkJob.create({ data: { organizationId: input.organizationId, brandId: input.brandId, promoId, actorId: input.actorId } });
    added.push(promoId);
  }
  if (added.length) await db.promo.updateMany({ where: { id: { in: added } }, data: { analysisStatus: "QUEUED", analysisError: null } });
  return added;
}

/**
 * Claim the next promo to analyze, or null when nothing is waiting or both
 * slots are taken. Also recovers runs whose server died (requeued, or failed
 * after too many attempts).
 */
export async function claimNextBulk(now = new Date(), limit = BULK_CONCURRENCY): Promise<ClaimedJob | null> {
  return rawPrisma().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_KEY}::bigint)`;
    // Deleted or suspended organizations: their queued runs wait (and resume if restored).
    const off = (await tx.organization.findMany({ where: { OR: [{ deletedAt: { not: null } }, { suspendedAt: { not: null } }] }, select: { id: true } })).map((row) => row.id);
    const rows = await tx.promoBulkJob.findMany({
      where: { status: { in: ["QUEUED", "RUNNING"] }, organizationId: { notIn: off } },
      select: { id: true, status: true, attempts: true, lockedAt: true, createdAt: true, organizationId: true, promoId: true },
      orderBy: { createdAt: "asc" },
      take: 500,
    });
    const recovery = planRecovery(rows, now);
    if (recovery.requeue.length) await tx.promoBulkJob.updateMany({ where: { id: { in: recovery.requeue } }, data: { status: "QUEUED", lockedAt: null } });
    if (recovery.fail.length) {
      await tx.promoBulkJob.updateMany({ where: { id: { in: recovery.fail } }, data: { status: "FAILED", error: "Stopped several times (the server restarted mid-run).", finishedAt: now } });
      const failedPromos = rows.filter((row) => recovery.fail.includes(row.id)).map((row) => row.promoId);
      await tx.promo.updateMany({ where: { id: { in: failedPromos }, analysisStatus: { in: ["QUEUED", "RUNNING"] } }, data: { analysisStatus: "FAILED", analysisError: "The analysis was interrupted several times. Try it again on its own." } });
    }
    const refreshed = rows.map((row) =>
      recovery.requeue.includes(row.id) ? { ...row, status: "QUEUED", lockedAt: null } : recovery.fail.includes(row.id) ? { ...row, status: "FAILED" } : row,
    );
    const [next] = pickClaims(refreshed, now, limit);
    if (!next) return null;
    const claimed = await tx.promoBulkJob.update({ where: { id: next }, data: { status: "RUNNING", lockedAt: now, attempts: { increment: 1 }, error: null } });
    return { id: claimed.id, organizationId: claimed.organizationId, brandId: claimed.brandId, promoId: claimed.promoId, actorId: claimed.actorId, attempts: claimed.attempts };
  });
}

export async function finishBulk(job: Pick<ClaimedJob, "id" | "organizationId">, outcome: { ok: boolean; error?: string | null }): Promise<void> {
  await tenantDb(job.organizationId).promoBulkJob.updateMany({
    where: { id: job.id, status: "RUNNING" },
    data: { status: outcome.ok ? "DONE" : "FAILED", error: outcome.ok ? null : (outcome.error ?? "The analysis failed.").slice(0, 1000), finishedAt: new Date(), lockedAt: null },
  });
}

export type BulkRunner = (job: ClaimedJob) => Promise<{ ok: boolean; error?: string | null }>;

/**
 * Work through the queue with up to `limit` workers until it is empty, the
 * time budget is spent, or `maxJobs` have run. Safe to call from several
 * servers at once: claims respect the global limit.
 */
export async function drainBulkQueue(input: { run: BulkRunner; maxJobs?: number; budgetMs?: number; limit?: number }): Promise<{ ran: number; failed: number }> {
  const started = Date.now();
  const limit = input.limit ?? BULK_CONCURRENCY;
  const maxJobs = input.maxJobs ?? 50;
  let ran = 0;
  let failed = 0;
  const worker = async () => {
    while (ran < maxJobs && Date.now() - started < (input.budgetMs ?? 10 * 60_000)) {
      const job = await claimNextBulk(new Date(), limit);
      if (!job) return;
      ran += 1;
      let outcome: { ok: boolean; error?: string | null };
      try {
        outcome = await input.run(job);
      } catch (error) {
        outcome = { ok: false, error: error instanceof Error ? error.message : "The analysis failed." };
      }
      if (!outcome.ok) failed += 1;
      await finishBulk(job, outcome);
    }
  };
  await Promise.all(Array.from({ length: limit }, worker));
  return { ran, failed };
}

/** Rows for the Bulk page: the latest batch state per promo in this brand. */
export async function bulkQueueRows(organizationId: string, brandId: string) {
  return tenantDb(organizationId).promoBulkJob.findMany({
    where: { brandId, OR: [{ status: { in: ["QUEUED", "RUNNING"] } }, { finishedAt: { gt: new Date(Date.now() - 24 * 3600_000) } }] },
    orderBy: { createdAt: "asc" },
    select: { id: true, promoId: true, status: true, attempts: true, error: true, lockedAt: true, createdAt: true, finishedAt: true },
    take: 500,
  });
}

/** Take waiting promos out of the queue (running ones finish). */
export async function cancelQueued(organizationId: string, brandId: string): Promise<number> {
  const db = tenantDb(organizationId);
  const waiting = await db.promoBulkJob.findMany({ where: { brandId, status: "QUEUED" }, select: { id: true, promoId: true } });
  if (!waiting.length) return 0;
  await db.promoBulkJob.updateMany({ where: { id: { in: waiting.map((w) => w.id) }, status: "QUEUED" }, data: { status: "CANCELLED", finishedAt: new Date() } });
  // Put the promos back to their last finished state.
  const promoIds = waiting.map((w) => w.promoId);
  const analyzed = await db.promoAnalysis.findMany({ where: { promoId: { in: promoIds } }, select: { promoId: true }, distinct: ["promoId"] });
  const done = new Set(analyzed.map((row) => row.promoId));
  await db.promo.updateMany({ where: { id: { in: promoIds.filter((id) => done.has(id)) }, analysisStatus: "QUEUED" }, data: { analysisStatus: "DONE" } });
  await db.promo.updateMany({ where: { id: { in: promoIds.filter((id) => !done.has(id)) }, analysisStatus: "QUEUED" }, data: { analysisStatus: "NONE" } });
  return waiting.length;
}
