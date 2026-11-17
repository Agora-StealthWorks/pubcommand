/**
 * Selection logic for the Forms scheduled jobs. Pure and unit tested; the jobs
 * in apps/web/src/jobs/forms-*.ts load rows, call these and write.
 */

/** Respondent files and logos younger than this are never reaped (a save may still be in flight). */
export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

export type FileRow = { id: string; kind: string; responseId: string | null; createdAt: Date };

/**
 * Files nothing points at any more:
 *  - a respondent upload/image/signature with no response (the response row
 *    was never written, or the submit failed half-way);
 *  - a logo no theme uses (replaced, or the theme save failed).
 * Logos of soft-deleted themes still count as used: staff can restore them.
 */
export function orphanFiles(files: readonly FileRow[], logoIdsInUse: ReadonlySet<string>, now: Date): string[] {
  const cutoff = now.getTime() - ORPHAN_GRACE_MS;
  return files
    .filter((file) => file.createdAt.getTime() < cutoff)
    .filter((file) => (file.kind === "logo" ? !logoIdsInUse.has(file.id) : !file.responseId))
    .map((file) => file.id);
}

export type ScheduleRow = {
  id: string;
  status: "DRAFT" | "OPEN" | "CLOSED";
  opensAt: Date | null;
  closesAt: Date | null;
  autoPublish: boolean;
  responseLimit: number | null;
  publishedAt: Date | null;
};

export type ScheduleAction = { id: string; action: "publish" | "close"; reason: "opens" | "closes" | "limit" };

/**
 * What the schedule job does to each form:
 *  - publish: a draft with "publish automatically" on, once opensAt has
 *    passed and while closesAt has not (the caller re-runs the publish checks
 *    and records why when they fail);
 *  - close: an open form past closesAt, or one that reached its response cap.
 * The public form already refuses responses outside the window; this keeps
 * the status shown to the team in step with it.
 */
export function scheduleActions(rows: readonly ScheduleRow[], completeCounts: ReadonlyMap<string, number>, now: Date): ScheduleAction[] {
  const actions: ScheduleAction[] = [];
  for (const row of rows) {
    const closed = row.closesAt !== null && row.closesAt.getTime() <= now.getTime();
    if (row.status === "DRAFT" && row.autoPublish && row.opensAt && row.opensAt.getTime() <= now.getTime() && !closed) {
      actions.push({ id: row.id, action: "publish", reason: "opens" });
    } else if (row.status === "OPEN" && closed) {
      actions.push({ id: row.id, action: "close", reason: "closes" });
    } else if (row.status === "OPEN" && row.responseLimit && (completeCounts.get(row.id) ?? 0) >= row.responseLimit) {
      actions.push({ id: row.id, action: "close", reason: "limit" });
    }
  }
  return actions;
}
