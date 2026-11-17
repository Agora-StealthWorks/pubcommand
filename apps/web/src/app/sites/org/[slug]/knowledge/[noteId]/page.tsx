import { Badge, Button, Input } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { deleteAttachment, deleteNote, moveNote, setNoteShared, uploadAttachment } from "@/features/brain/actions";
import { brainHref, loadBrain } from "@/features/brain/context";
import { renderNote } from "@/features/brain/markdown";
import { backlinks, getVisibleNote, noteAttachments, noteResolver } from "@/features/brain/notes";
import { NoteBadges } from "@/features/brain/parts";
import { findAttachment, isInlineImage } from "../../../../../../../../../modules/knowledge/attachments";
import { folderAncestors } from "../../../../../../../../../modules/knowledge/folders";
import { canEditNoteInScope, isBestPractice, originLabel, sourceLabel } from "../../../../../../../../../modules/knowledge/visibility";

function kb(size: number) {
  return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
}

export default async function NotePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; noteId: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { slug, noteId } = await params;
  const query = await searchParams;
  const loaded = await loadBrain(slug);
  if (loaded.kind === "missing") notFound();
  if (loaded.kind === "denied") return <Denied title={loaded.title} />;
  const { ctx } = loaded;
  const scope = ctx.brain;
  const orgId = ctx.resolved.id;
  const note = await getVisibleNote(orgId, scope, noteId);
  if (!note) notFound();
  const [resolve, files, linksIn] = await Promise.all([noteResolver(orgId, scope), noteAttachments(orgId, note.id), backlinks(orgId, scope, note)]);
  const { html, properties } = renderNote(
    note.body,
    (target) => {
      const hit = resolve(target);
      return hit ? { href: brainHref(`/knowledge/${hit.id}`), title: hit.title } : null;
    },
    (target) => {
      const file = findAttachment(files, target);
      if (!file) return null;
      const href = `/knowledge/files/${file.id}`;
      return isInlineImage(file.contentType) ? { kind: "image", src: href, alt: file.filename } : { kind: "file", href, name: file.filename };
    },
  );
  const editable = ctx.canWrite && canEditNoteInScope(scope, note);
  const bestPractice = isBestPractice(note);
  const foreign = !bestPractice && note.brandId !== scope.brandId;
  const origin = originLabel(note, ctx.brandNames);

  return (
    <div className="grid max-w-6xl gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
      <article className="min-w-0">
        <nav className="mb-2 flex flex-wrap items-center gap-1 text-sm text-muted" aria-label="Folder">
          <Link href={brainHref("/knowledge")} className="hover:text-ink">
            {ctx.scopeLabel}
          </Link>
          {folderAncestors(note.folder).map((path) => (
            <span key={path} className="flex min-w-0 items-center gap-1">
              <span aria-hidden>/</span>
              <Link href={brainHref("/knowledge", { folder: path })} className="break-all hover:text-ink">
                {path.split("/").pop()}
              </Link>
            </span>
          ))}
        </nav>
        <Flash error={query.error} notice={query.notice} />
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight">{note.title}</h1>
          <NoteBadges note={note} scope={scope} brandNames={ctx.brandNames} />
        </div>
        {foreign ? (
          <p className="mt-3 rounded-md border border-[#c7d7fe] bg-[#eef4ff] px-3 py-2 text-sm text-[#1e3a8a]">
            Shared by <strong>{origin}</strong>. You can read it here; that brand edits it.
          </p>
        ) : null}
        {bestPractice ? (
          <p className="mt-3 rounded-md border border-line bg-white px-3 py-2 text-sm text-muted">A best-practice note included in your Brain. It is read-only and kept up to date for you.</p>
        ) : null}
        {properties.length > 0 ? (
          <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 rounded-lg border border-line bg-white px-4 py-3 text-sm">
            {properties.slice(0, 12).map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-muted">{key}</dt>
                <dd className="min-w-0 break-words">{value || "—"}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <div className="brain-prose mt-4 rounded-xl border border-line bg-white p-5" dangerouslySetInnerHTML={{ __html: html }} />
      </article>

      <aside className="min-w-0 space-y-4">
        <section className="rounded-xl border border-line bg-white p-4 text-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">About this note</h2>
          <dl className="mt-2 space-y-1.5">
            {foreign ? (
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Brand</dt>
                <dd className="text-right">{origin}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Visibility</dt>
              <dd className="text-right">
                {bestPractice ? "Read-only" : note.visibility === "SHARED" ? <Badge tone="ok">Shared across brands</Badge> : "Private to this brand"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Taught by</dt>
              <dd className="text-right">{sourceLabel(note.source)}</dd>
            </div>
            {note.sourceRef?.startsWith("vault:") ? (
              <div>
                <dt className="text-muted">Vault file</dt>
                <dd className="break-all text-xs">{note.sourceRef.slice(6)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Updated</dt>
              <dd className="text-right">{note.updatedAt.toISOString().slice(0, 10)}</dd>
            </div>
            {note.sharedAt && !bestPractice ? (
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Shared</dt>
                <dd className="text-right">{note.sharedAt.toISOString().slice(0, 10)}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section className="rounded-xl border border-line bg-white p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Attachments · {files.length}</h2>
          {files.length === 0 ? <p className="mt-2 text-sm text-muted">No files attached.</p> : null}
          <ul className="mt-2 space-y-1.5">
            {files.map((file) => (
              <li key={file.id} className="flex items-center justify-between gap-2 text-sm">
                <a href={`/knowledge/files/${file.id}`} className="min-w-0 break-all text-accent hover:underline">
                  {file.filename}
                </a>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
                  {kb(file.size)}
                  {editable ? (
                    <form action={deleteAttachment}>
                      <input type="hidden" name="noteId" value={note.id} />
                      <input type="hidden" name="attachmentId" value={file.id} />
                      <button type="submit" className="min-h-8 px-1 text-[#b42318] hover:underline" aria-label={`Remove ${file.filename}`}>
                        Remove
                      </button>
                    </form>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          {editable ? (
            <form action={uploadAttachment} className="mt-3 space-y-2 border-t border-line pt-3">
              <input type="hidden" name="noteId" value={note.id} />
              <label htmlFor="attach-file" className="text-sm font-semibold">
                Attach an image or file
              </label>
              <input id="attach-file" name="file" type="file" required className="block w-full text-sm file:mr-2 file:rounded-md file:border-0 file:bg-canvas file:px-3 file:py-2 file:text-sm" />
              <p className="text-xs text-muted">Up to 10 MB. Images are shown in the note where ![[file name]] appears; one is added at the end.</p>
              <Button type="submit" variant="secondary" className="w-full">
                Attach
              </Button>
            </form>
          ) : null}
        </section>

        <section className="rounded-xl border border-line bg-white p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Linked from · {linksIn.length}</h2>
          {linksIn.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No notes in this Brain link here yet.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {linksIn.slice(0, 40).map((row) => (
                <li key={row.id}>
                  <Link href={brainHref(`/knowledge/${row.id}`)} className="block break-words text-sm text-accent hover:underline">
                    {row.title}
                  </Link>
                </li>
              ))}
              {linksIn.length > 40 ? <li className="pt-1 text-xs text-muted">+{linksIn.length - 40} more</li> : null}
            </ul>
          )}
        </section>

        {editable ? (
          <section className="space-y-4 rounded-xl border border-line bg-white p-4">
            <Link href={brainHref(`/knowledge/${note.id}/edit`)} className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-accent px-3 text-sm font-semibold text-white">
              Edit note
            </Link>
            <form action={moveNote} className="space-y-2">
              <input type="hidden" name="noteId" value={note.id} />
              <label htmlFor="move-folder" className="text-sm font-semibold">
                Folder
              </label>
              <Input id="move-folder" name="folder" defaultValue={note.folder ?? ""} placeholder="Top level" maxLength={300} />
              <Button type="submit" variant="secondary" className="w-full">
                Move
              </Button>
            </form>
            {ctx.canShare && ctx.brands.length > 1 ? (
              <form action={setNoteShared} className="space-y-2 border-t border-line pt-4">
                <input type="hidden" name="noteId" value={note.id} />
                <input type="hidden" name="shared" value={note.visibility === "SHARED" ? "false" : "true"} />
                <p className="text-sm font-semibold">{note.visibility === "SHARED" ? "Shared across brands" : "Share with your other brands"}</p>
                <p className="text-xs text-muted">
                  {note.visibility === "SHARED"
                    ? "Your organization's other brands can read this note. Unshare it to keep it to this brand."
                    : "Only share generic know-how. Never share a brand's private data, results or plans."}
                </p>
                <Button type="submit" variant="secondary" className="w-full">
                  {note.visibility === "SHARED" ? "Unshare" : "Share with other brands"}
                </Button>
              </form>
            ) : null}
            <details className="border-t border-line pt-4">
              <summary className="cursor-pointer text-sm font-semibold text-[#b42318]">Delete…</summary>
              <form action={deleteNote} className="mt-2 space-y-2">
                <input type="hidden" name="noteId" value={note.id} />
                <p className="text-xs text-muted">The note disappears from the Brain and from search. An app that taught it may write it again.</p>
                <Button type="submit" variant="danger" className="w-full">
                  Delete note
                </Button>
              </form>
            </details>
          </section>
        ) : null}
      </aside>
    </div>
  );
}
