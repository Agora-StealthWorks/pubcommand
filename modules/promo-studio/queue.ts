/**
 * The bulk re-analysis queue, kept in the database (promo_bulk_jobs) so it
 * survives restarts. A scheduled job drains it; this file holds the pure
 * decisions (what is stuck, what may start) so they are unit tested.
 */

/** Bulk re-analysis runs at most this many promos at once, across every server. */
export const BULK_CONCURRENCY = 2;
export const BULK_MAX = 50;
/** A RUNNING row not touched for this long belonged to a server that stopped. */
export const BULK_STALE_MS = 20 * 60 * 1000;
/** After this many starts a promo is marked failed instead of retried. */
export const BULK_MAX_ATTEMPTS = 3;

export type BulkStatus = "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "CANCELLED";
export type BulkRow = { id: string; status: string; attempts: number; lockedAt: Date | null; createdAt: Date };

export function isStaleRun(row: Pick<BulkRow, "status" | "lockedAt">, now: Date): boolean {
  return row.status === "RUNNING" && (!row.lockedAt || now.getTime() - row.lockedAt.getTime() > BULK_STALE_MS);
}

/** Runs whose server died: retried while they have attempts left, failed after that. */
export function planRecovery(rows: readonly BulkRow[], now: Date): { requeue: string[]; fail: string[] } {
  const requeue: string[] = [];
  const fail: string[] = [];
  for (const row of rows) {
    if (!isStaleRun(row, now)) continue;
    (row.attempts >= BULK_MAX_ATTEMPTS ? fail : requeue).push(row.id);
  }
  return { requeue, fail };
}

/**
 * Which queued rows may start now: oldest first, only into free slots. Stale
 * RUNNING rows do not hold a slot (recovery requeues them).
 */
export function pickClaims(rows: readonly BulkRow[], now: Date, limit = BULK_CONCURRENCY): string[] {
  const running = rows.filter((row) => row.status === "RUNNING" && !isStaleRun(row, now)).length;
  const free = Math.max(0, limit - running);
  if (!free) return [];
  return rows
    .filter((row) => row.status === "QUEUED")
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
    .slice(0, free)
    .map((row) => row.id);
}

/** Counts for the Bulk page banner. */
export function queueSummary(rows: readonly Pick<BulkRow, "status">[]): Record<BulkStatus, number> {
  const out: Record<BulkStatus, number> = { QUEUED: 0, RUNNING: 0, DONE: 0, FAILED: 0, CANCELLED: 0 };
  for (const row of rows) if (row.status in out) out[row.status as BulkStatus] += 1;
  return out;
}
