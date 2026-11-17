/**
 * Two-way sync with an agent platform, decided by content hash.
 *
 * PUSH: render the profile's documents; create what is new, update what changed, delete
 * what left the scope, skip what is unchanged. A document someone edited on the platform
 * is held (not overwritten) until a person decides in the review queue.
 *
 * PULL: re-read each pushed document and compare its hash with the baseline taken right
 * after our own push (remoteHash), never with what we sent: a platform may re-format text.
 * A difference means someone edited it there.
 */
import { contentHash, type Doc } from "./render";

export type SyncRow = {
  id: string;
  docKey: string;
  remoteId: string | null;
  contentHash: string;
  remoteHash: string | null;
  /** synced | pending | error | remote_changed */
  status: string;
};

export type PushPlan = {
  create: Doc[];
  update: { doc: Doc; row: SyncRow }[];
  remove: SyncRow[];
  unchanged: Doc[];
  held: Doc[];
};

export function planPush(docs: readonly Doc[], rows: readonly SyncRow[], options: { force?: boolean } = {}): PushPlan {
  const byKey = new Map(rows.map((row) => [row.docKey, row]));
  const plan: PushPlan = { create: [], update: [], remove: [], unchanged: [], held: [] };
  for (const d of docs) {
    const row = byKey.get(d.docKey);
    byKey.delete(d.docKey);
    if (row?.status === "remote_changed" && !options.force) plan.held.push(d);
    else if (!row?.remoteId) plan.create.push(d);
    else if (row.contentHash === d.hash && row.status === "synced" && !options.force) plan.unchanged.push(d);
    else plan.update.push({ doc: d, row });
  }
  plan.remove = [...byKey.values()];
  return plan;
}

export type PullDecision = "unchanged" | "remote_changed" | "baseline";

/** What a re-read of a pushed document means. No baseline yet → take this one. */
export function pullDecision(row: Pick<SyncRow, "remoteHash">, remoteText: string): PullDecision {
  if (!row.remoteHash) return "baseline";
  return contentHash(remoteText) === row.remoteHash ? "unchanged" : "remote_changed";
}

export function planSummary(plan: PushPlan): { create: number; update: number; remove: number; unchanged: number; held: number } {
  return { create: plan.create.length, update: plan.update.length, remove: plan.remove.length, unchanged: plan.unchanged.length, held: plan.held.length };
}
