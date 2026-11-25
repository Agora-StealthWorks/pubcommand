import { randomUUID } from "node:crypto";
import type { Prisma} from "@pubcommand/db";
import { platformTx } from "@pubcommand/db";

/**
 * The Operations Brain: the area of the Master Brain about how PubCommand is used and how the
 * business runs (marketing tactics, copy, strategy trends, people's behavior). Its own table
 * (ops_brain_notes), so these notes never mix with the marketing knowledge pushed to brands.
 */

export const OPS_KINDS = ["daily", "weekly", "note"] as const;
export type OpsKind = (typeof OPS_KINDS)[number];
export const OPS_KIND_LABELS: Record<OpsKind, string> = { daily: "Daily read", weekly: "Weekly strategy", note: "Note" };

const LIST_SELECT = { id: true, key: true, kind: true, title: true, periodStart: true, periodEnd: true, source: true, model: true, createdAt: true, updatedAt: true } as const;
export type OpsNoteRow = Prisma.OpsBrainNoteGetPayload<{ select: typeof LIST_SELECT }>;

export async function listOpsNotes(filter: { kind?: string | null; take?: number; before?: Date | null } = {}): Promise<OpsNoteRow[]> {
  return platformTx((tx) =>
    tx.opsBrainNote.findMany({
      where: { deletedAt: null, ...(filter.kind && OPS_KINDS.includes(filter.kind as OpsKind) ? { kind: filter.kind } : {}), ...(filter.before ? { createdAt: { lt: filter.before } } : {}) },
      orderBy: [{ periodStart: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: Math.min(Math.max(filter.take ?? 50, 1), 200),
      select: LIST_SELECT,
    }),
  );
}

export async function getOpsNote(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return platformTx((tx) => tx.opsBrainNote.findFirst({ where: { id, deletedAt: null } }));
}

export async function opsNoteCounts(): Promise<Record<string, number>> {
  const rows = await platformTx((tx) => tx.opsBrainNote.groupBy({ by: ["kind"], where: { deletedAt: null }, _count: { _all: true } }));
  return Object.fromEntries(rows.map((row) => [row.kind, row._count._all]));
}

export type OpsHit = OpsNoteRow & { snippet: string; rank: number };

/** Full-text search (title weighted over body), newest first on ties. */
export async function searchOpsNotes(query: string, limit = 20): Promise<OpsHit[]> {
  const q = query.trim().slice(0, 300);
  if (!q) return [];
  const rows = await platformTx(
    (tx) => tx.$queryRaw<{ id: string; rank: number; snippet: string }[]>`
      SELECT id, ts_rank(search_vector, websearch_to_tsquery('english', ${q})) AS rank,
             ts_headline('english', body, websearch_to_tsquery('english', ${q}), 'MaxWords=30, MinWords=10, StartSel=«, StopSel=»') AS snippet
      FROM ops_brain_notes
      WHERE deleted_at IS NULL AND search_vector @@ websearch_to_tsquery('english', ${q})
      ORDER BY rank DESC, created_at DESC LIMIT ${Math.min(Math.max(limit, 1), 50)}`,
  );
  if (rows.length === 0) return [];
  const notes = await platformTx((tx) => tx.opsBrainNote.findMany({ where: { id: { in: rows.map((row) => row.id) } }, select: LIST_SELECT }));
  const byId = new Map(notes.map((note) => [note.id, note]));
  return rows.flatMap((row) => {
    const note = byId.get(row.id);
    return note ? [{ ...note, snippet: row.snippet, rank: row.rank }] : [];
  });
}

/** Writes (or rewrites) a generated note. A note staff edited (source "staff") is left alone. */
export async function upsertGeneratedOpsNote(input: { key: string; kind: OpsKind; title: string; body: string; periodStart: Date; periodEnd: Date; stats: Prisma.InputJsonValue; model: string | null }): Promise<"created" | "updated" | "kept"> {
  return platformTx(async (tx) => {
    const existing = await tx.opsBrainNote.findUnique({ where: { key: input.key }, select: { id: true, source: true } });
    const data = { kind: input.kind, title: input.title.slice(0, 200), body: input.body, periodStart: input.periodStart, periodEnd: input.periodEnd, stats: input.stats, model: input.model };
    if (!existing) {
      await tx.opsBrainNote.create({ data: { key: input.key, source: "usage-insights", ...data } });
      return "created";
    }
    if (existing.source !== "usage-insights") return "kept";
    await tx.opsBrainNote.update({ where: { id: existing.id }, data: { ...data, deletedAt: null } });
    return "updated";
  });
}

/** A note written by staff or a platform agent. */
export async function saveOpsNote(input: { id?: string | null; title: string; body: string; actorId: string; source: "staff" | "ai-agent" }) {
  const title = input.title.trim().slice(0, 200);
  const body = input.body.trim().slice(0, 200_000);
  if (!title || !body) throw new Error("A title and a body are needed.");
  return platformTx(async (tx) => {
    if (input.id) {
      const existing = await tx.opsBrainNote.findFirst({ where: { id: input.id, deletedAt: null } });
      if (!existing) throw new Error("That note no longer exists.");
      return tx.opsBrainNote.update({ where: { id: existing.id }, data: { title, body, source: input.source === "staff" ? "staff" : existing.source === "usage-insights" ? "staff" : existing.source } });
    }
    const id = randomUUID();
    return tx.opsBrainNote.create({ data: { id, key: `note:${id}`, kind: "note", title, body, source: input.source, createdById: input.actorId } });
  });
}

export async function deleteOpsNote(id: string) {
  await platformTx((tx) => tx.opsBrainNote.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } }));
}
