import { Denied, Flash } from "@/components/ui";
import { NoteForm } from "@/features/brain/note-form";
import { createMainNote } from "@/features/main-brain/actions";
import { brainStaff } from "@/features/main-brain/staff";
import { normalizeFolder } from "../../../../../../../../modules/knowledge/folders";

export default async function NewMainNotePage({ searchParams }: { searchParams: Promise<{ folder?: string; error?: string }> }) {
  const query = await searchParams;
  if (!(await brainStaff())) return <Denied />;
  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">New main-Brain note</h1>
      <p className="mb-4 text-sm text-muted">Platform knowledge. No brand sees it unless you push it down from its page.</p>
      <Flash error={query.error} />
      <NoteForm action={createMainNote} cancelHref="/brain" folder={normalizeFolder(query.folder)} targetLabel="the main Brain" niche="general" />
    </div>
  );
}
