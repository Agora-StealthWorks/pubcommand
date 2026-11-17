import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { updateNote } from "@/features/brain/actions";
import { brainHref, loadBrain } from "@/features/brain/context";
import { NoteForm } from "@/features/brain/note-form";
import { getVisibleNote } from "@/features/brain/notes";
import { canEditNoteInScope, originLabel } from "../../../../../../../../../../modules/knowledge/visibility";

export default async function EditNotePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; noteId: string }>;
  searchParams: Promise<{ scope?: string; error?: string }>;
}) {
  const { slug, noteId } = await params;
  const query = await searchParams;
  const loaded = await loadBrain(slug, query.scope);
  if (loaded.kind === "missing") notFound();
  if (loaded.kind === "denied") return <Denied title={loaded.title} />;
  const { ctx } = loaded;
  if (!ctx.canWrite) return <Denied title="You can read the Brain but not edit it" />;
  const note = await getVisibleNote(ctx.resolved.id, ctx.brain, noteId);
  if (!note) notFound();
  if (!canEditNoteInScope(ctx.brain, note)) return <Denied title="This note is edited in its own Brain" />;
  return (
    <div className="max-w-3xl">
      <h1 className="mb-4 break-words text-2xl font-semibold tracking-tight">Edit “{note.title}”</h1>
      <Flash error={query.error} />
      <NoteForm
        action={updateNote}
        scopeMain={ctx.brain.kind === "main"}
        cancelHref={brainHref(`/knowledge/${note.id}`, ctx.brain)}
        note={note}
        targetLabel={originLabel(note, ctx.brandNames)}
      />
    </div>
  );
}
