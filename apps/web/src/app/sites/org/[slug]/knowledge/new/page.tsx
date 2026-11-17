import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { createNote } from "@/features/brain/actions";
import { brainHref, loadBrain } from "@/features/brain/context";
import { NoteForm } from "@/features/brain/note-form";
import { normalizeFolder } from "../../../../../../../../../modules/knowledge/folders";

export default async function NewNotePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ scope?: string; folder?: string; error?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const loaded = await loadBrain(slug, query.scope);
  if (loaded.kind === "missing") notFound();
  if (loaded.kind === "denied") return <Denied title={loaded.title} />;
  const { ctx } = loaded;
  if (!ctx.canWrite) return <Denied title="You can read the Brain but not add notes" />;
  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">New note</h1>
      <p className="mb-4 text-sm text-muted">
        {ctx.brain.kind === "main"
          ? "Main Brain notes are organization-wide and stay out of brand mini-brains unless shared."
          : "Private to this brand. An admin can share it with every brand later if it is a generic best practice."}
      </p>
      <Flash error={query.error} />
      <NoteForm
        action={createNote}
        scopeMain={ctx.brain.kind === "main"}
        cancelHref={brainHref("/knowledge", ctx.brain)}
        folder={normalizeFolder(query.folder)}
        targetLabel={ctx.scopeLabel}
      />
    </div>
  );
}
