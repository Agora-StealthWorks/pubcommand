import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { NoteForm } from "@/features/brain/note-form";
import { updateMainNote } from "@/features/main-brain/actions";
import { getMainNote } from "@/features/main-brain/notes";
import { brainStaff } from "@/features/main-brain/staff";

export default async function EditMainNotePage({ params, searchParams }: { params: Promise<{ noteId: string }>; searchParams: Promise<{ error?: string }> }) {
  const { noteId } = await params;
  const query = await searchParams;
  if (!(await brainStaff())) return <Denied />;
  const note = await getMainNote(noteId);
  if (!note) notFound();
  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 break-words text-2xl font-semibold tracking-tight">Edit “{note.title}”</h1>
      <p className="mb-4 text-sm text-muted">
        {note.origin === "LEARNED" ? "Your edit wins over later writes from the app that taught it. " : ""}
        {note.pushScope !== "NONE" ? "Brands that have this note get the new version." : ""}
      </p>
      <Flash error={query.error} />
      <NoteForm action={updateMainNote} cancelHref={`/brain/${note.id}`} note={note} targetLabel="the main Brain" niche={note.niche} />
    </div>
  );
}
