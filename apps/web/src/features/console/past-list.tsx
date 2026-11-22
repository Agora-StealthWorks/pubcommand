import Link from "next/link";
import type { PastNote } from "./past-data";

/** Master Brain notes learned from past promos or videos. */
export function PastNoteList({ notes, empty }: { notes: PastNote[]; empty: string }) {
  if (notes.length === 0) return <div className="rounded-xl border border-line bg-white p-6 text-sm text-muted">{empty}</div>;
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
      {notes.map((note) => (
        <li key={note.id}>
          <Link href={`/brain/${note.id}`} className="block min-w-0 px-4 py-3 hover:bg-canvas">
            <span className="pc-break block text-sm font-semibold text-ink">{note.title}</span>
            <span className="mt-0.5 block break-words text-xs text-muted">
              {[note.where, note.folder ?? "Top level", note.updatedAt.toISOString().slice(0, 10)].join(" · ")}
            </span>
            {note.snippet ? <span className="mt-1 block break-words text-sm text-muted">{note.snippet}</span> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}
