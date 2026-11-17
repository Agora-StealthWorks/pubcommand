import { mainBrain } from "../main-brain/db";

/**
 * Main-Brain notes marked outdated in the conflict review. They stay in the main
 * Brain (flagged on their page) but Ask and the conflict check skip them.
 */
export async function supersededNoteIds(noteIds?: readonly string[]): Promise<Set<string>> {
  if (noteIds && noteIds.length === 0) return new Set();
  const rows = await mainBrain((tx) => tx.mainBrainNoteFlag.findMany({ where: noteIds ? { noteId: { in: [...noteIds] } } : {}, select: { noteId: true } }));
  return new Set(rows.map((row) => row.noteId));
}

export async function noteFlag(noteId: string) {
  return mainBrain((tx) => tx.mainBrainNoteFlag.findUnique({ where: { noteId } }));
}
