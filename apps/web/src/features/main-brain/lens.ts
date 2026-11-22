import { frameNote, needsFraming } from "../../../../../modules/knowledge/industry-lens";
import { mainBrain } from "./db";

/**
 * Put every Master Brain note in the industry lens (no "competitors": they are
 * an organization's view). Learn-up and imports already frame new notes; this
 * covers notes that arrived before. Idempotent; only changed notes are written,
 * and a staff edit stays a staff edit (editedAt is left as it is).
 */
export async function reframeMainBrainNotes(): Promise<{ checked: number; reframed: number }> {
  let checked = 0;
  let reframed = 0;
  let cursor: string | null = null;
  for (;;) {
    const rows: { id: string; title: string; body: string; folder: string | null }[] = await mainBrain((tx) =>
      tx.mainBrainNote.findMany({
        where: { deletedAt: null, ...(cursor ? { id: { gt: cursor } } : {}) },
        orderBy: { id: "asc" },
        take: 300,
        select: { id: true, title: true, body: true, folder: true },
      }),
    );
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]!.id;
    checked += rows.length;
    const changed = rows.filter((row) => needsFraming(row)).map((row) => frameNote(row));
    if (changed.length) {
      await mainBrain(
        async (tx) => {
          for (const note of changed) await tx.mainBrainNote.update({ where: { id: note.id }, data: { title: note.title.slice(0, 200), body: note.body, folder: note.folder } });
        },
        { timeout: 60_000 },
      );
      reframed += changed.length;
    }
  }
  return { checked, reframed };
}
