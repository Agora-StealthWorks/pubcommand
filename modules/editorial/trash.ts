/**
 * Trash and restore for events, issues and series. Everything the calendar
 * deletes is soft-deleted (deletedAt) and can come back until someone empties it.
 *
 * A series goes to the trash with every live occurrence, all stamped with the
 * same instant. Restoring the series brings back exactly those occurrences, not
 * ones that were trashed earlier on their own.
 */

export type TrashKind = "event" | "issue" | "series";

export function isTrashKind(value: unknown): value is TrashKind {
  return value === "event" || value === "issue" || value === "series";
}

/** Occurrences to restore with a series: those trashed at the same instant as it. */
export function seriesRestoreSet(seriesDeletedAt: Date, occurrences: { id: string; deletedAt: Date | null }[]): string[] {
  const at = seriesDeletedAt.getTime();
  return occurrences.filter((o) => o.deletedAt && Math.abs(o.deletedAt.getTime() - at) < 1000).map((o) => o.id);
}

/** Why one trashed event cannot be restored on its own, or null when it can. */
export function eventRestoreBlocker(event: { seriesId: string | null }, series: { deletedAt: Date | null } | null): string | null {
  if (event.seriesId && series?.deletedAt) return "Its series is in the trash. Restore the series to bring its occurrences back.";
  return null;
}

/** Trashed rows older than this are listed as "will be emptied" hints only; nothing is purged automatically. */
export const TRASH_HINT_DAYS = 30;

export function daysInTrash(deletedAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - deletedAt.getTime()) / 86_400_000));
}
