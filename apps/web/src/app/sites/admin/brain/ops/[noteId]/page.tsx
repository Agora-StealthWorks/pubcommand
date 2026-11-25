import { Button } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { renderNote } from "@/features/brain/markdown";
import { brainStaff } from "@/features/main-brain/staff";
import { deleteOpsNoteAction } from "@/features/usage/ops-actions";
import { OPS_KIND_LABELS, getOpsNote, opsTitleIndex, type OpsKind } from "@/features/usage/ops-brain";
import { when } from "@/features/usage/parts";

export default async function OpsNotePage({ params, searchParams }: { params: Promise<{ noteId: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { noteId } = await params;
  const query = await searchParams;
  if (!(await brainStaff())) return <Denied />;
  const note = await getOpsNote(noteId);
  if (!note) notFound();
  const titles = await opsTitleIndex();
  const { html } = renderNote(note.body, (target) => {
    const hit = titles.get(target.trim().toLowerCase());
    return hit ? { href: `/brain/ops/${hit.id}`, title: hit.title } : null;
  });
  const source = note.source === "usage-insights" ? `Written by the usage.insights job${note.model ? ` (${note.model})` : " (no AI: factual digest)"}` : note.source === "docs" ? "Synced from PubCommand's documentation" : note.source === "ai-agent" ? "Saved by a platform AI agent" : "Written or edited by staff";
  return (
    <div className="min-w-0">
      <Flash error={query.error} notice={query.notice} />
      <p className="text-sm">
        <Link href={note.kind === "reference" ? "/brain/ops?kind=reference" : "/brain/ops"} className="text-accent hover:underline">← {note.kind === "reference" ? "How PubCommand works" : "Operations Brain"}</Link>
      </p>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted">{OPS_KIND_LABELS[note.kind as OpsKind] ?? note.kind}{note.folder ? ` · ${note.folder}` : ""} · {note.periodStart ? when(note.periodStart) : when(note.createdAt)}</p>
          <h1 className="pc-break mt-1 text-2xl font-semibold">{note.title}</h1>
          <p className="mt-1 text-xs text-muted">{source} · updated {when(note.updatedAt)}</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/brain/ops/${note.id}/edit`} className="inline-flex min-h-9 items-center rounded-md border border-line bg-white px-3 text-sm font-medium hover:bg-canvas">Edit</Link>
          <form action={deleteOpsNoteAction}>
            <input type="hidden" name="id" value={note.id} />
            <Button type="submit" variant="secondary" size="sm">Delete</Button>
          </form>
        </div>
      </div>
      <div className="brain-prose mt-4 rounded-xl border border-line bg-white p-5" dangerouslySetInnerHTML={{ __html: html }} />
      {note.source === "usage-insights" || note.source === "docs" ? null : <p className="mt-2 text-xs text-muted">Edited notes are never overwritten by the nightly job.</p>}
    </div>
  );
}
