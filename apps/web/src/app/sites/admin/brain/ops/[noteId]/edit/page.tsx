import { notFound } from "next/navigation";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { brainStaff } from "@/features/main-brain/staff";
import { getOpsNote } from "@/features/usage/ops-brain";
import { OpsNoteForm } from "../../ops-form";

export default async function EditOpsNotePage({ params, searchParams }: { params: Promise<{ noteId: string }>; searchParams: Promise<{ error?: string }> }) {
  const { noteId } = await params;
  const query = await searchParams;
  if (!(await brainStaff())) return <Denied />;
  const note = await getOpsNote(noteId);
  if (!note) notFound();
  return (
    <div className="max-w-3xl">
      <PageHeader title="Edit note" description={note.source === "usage-insights" ? "Once you save, the nightly job will no longer rewrite this note." : undefined} />
      <Flash error={query.error} />
      <OpsNoteForm note={{ id: note.id, title: note.title, body: note.body }} />
    </div>
  );
}
