import { NICHE_LABELS } from "@pubcommand/core";
import { rawPrisma } from "@pubcommand/db";
import { Badge, Button } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { renderNote } from "@/features/brain/markdown";
import { restoreNote } from "@/features/brain-conflicts/actions";
import { noteFlag } from "@/features/brain-conflicts/flags";
import { deleteMainAttachment, deleteMainNote, setPushDown, uploadMainAttachment } from "@/features/main-brain/actions";
import { getMainNote, mainBacklinks, mainResolver, provenanceNames } from "@/features/main-brain/notes";
import { OriginBadge, provenanceOf } from "@/features/main-brain/parts";
import { pushedCopies } from "@/features/main-brain/push";
import { brainStaff } from "@/features/main-brain/staff";
import { findAttachment, isInlineImage } from "../../../../../../../../modules/knowledge/attachments";
import { folderAncestors } from "../../../../../../../../modules/knowledge/folders";
import { noteFitsBrand, originText } from "../../../../../../../../modules/knowledge/main-brain";
import { sourceLabel } from "../../../../../../../../modules/knowledge/visibility";

function size(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-right">{children}</dd>
    </div>
  );
}

export default async function MainNotePage({ params, searchParams }: { params: Promise<{ noteId: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { noteId } = await params;
  const query = await searchParams;
  if (!(await brainStaff())) return <Denied />;
  const note = await getMainNote(noteId);
  if (!note) notFound();
  const [resolve, names, linksIn, copies, orgs, outdated] = await Promise.all([
    mainResolver(),
    provenanceNames(),
    mainBacklinks(note),
    pushedCopies(note.id),
    rawPrisma().organization.findMany({ select: { id: true, name: true, suspendedAt: true, brands: { select: { id: true, name: true, niche: true }, orderBy: { name: "asc" } } }, orderBy: { name: "asc" } }),
    noteFlag(note.id),
  ]);
  const { html, properties } = renderNote(
    note.body,
    (target) => {
      const hit = resolve(target);
      return hit ? { href: `/brain/${hit.id}`, title: hit.title } : null;
    },
    (target) => {
      const file = findAttachment(note.attachments, target);
      if (!file) return null;
      const href = `/brain/files/${file.id}`;
      return isInlineImage(file.contentType) ? { kind: "image", src: href, alt: file.filename } : { kind: "file", href, name: file.filename };
    },
  );
  const p = provenanceOf(note, names);
  const org = note.originOrganizationId ? names.orgs.get(note.originOrganizationId) : null;
  const selected = new Set(note.pushTargets.map((target) => target.brandId));
  const copyBrands = new Set(copies.map((copy) => copy.brandId));

  return (
    <div className="grid max-w-6xl gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <article className="min-w-0">
        <nav className="mb-2 flex flex-wrap items-center gap-1 text-sm text-muted" aria-label="Folder">
          <Link href="/brain" className="hover:text-ink">
            Main Brain
          </Link>
          {folderAncestors(note.folder).map((path) => (
            <span key={path} className="flex min-w-0 items-center gap-1">
              <span aria-hidden>/</span>
              <Link href={`/brain?folder=${encodeURIComponent(path)}`} className="break-all hover:text-ink">
                {path.split("/").pop()}
              </Link>
            </span>
          ))}
        </nav>
        <Flash error={query.error} notice={query.notice} />
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight">{note.title}</h1>
          <OriginBadge origin={note.origin} />
          {note.pushScope !== "NONE" ? <Badge tone="ok">Pushed down</Badge> : null}
        </div>
        {note.editedAt && note.origin === "LEARNED" ? (
          <p className="mt-3 rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
            Edited here on {note.editedAt.toISOString().slice(0, 10)}. Later writes from {sourceLabel(note.source)} no longer change this note.
          </p>
        ) : null}
        {outdated ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm text-[#912018]">
            <span className="min-w-0 break-words">
              Marked outdated on {outdated.supersededAt.toISOString().slice(0, 10)}
              {outdated.reason ? `: ${outdated.reason}` : "."} Ask does not use it.
              {outdated.conflictId ? (
                <>
                  {" "}
                  <Link href={`/brain/conflicts/${outdated.conflictId}`} className="font-semibold underline">
                    See the conflict
                  </Link>
                </>
              ) : null}
            </span>
            <form action={restoreNote}>
              <input type="hidden" name="noteId" value={note.id} />
              <button type="submit" className="min-h-9 font-semibold underline">
                Restore
              </button>
            </form>
          </div>
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
        <section className="rounded-xl border border-line bg-white p-4 text-sm" aria-labelledby="prov-h">
          <h2 id="prov-h" className="text-xs font-semibold uppercase tracking-wide text-muted">
            Provenance
          </h2>
          <dl className="mt-2 space-y-1.5">
            <Row label="How">{originText(note.origin)}</Row>
            {org ? (
              <Row label="Organization">
                <Link href={`/orgs/${note.originOrganizationId}`} className="text-accent hover:underline">
                  {org.name}
                </Link>
              </Row>
            ) : note.originOrganizationId ? (
              <Row label="Organization">Deleted</Row>
            ) : null}
            {note.originBrandId ? <Row label="Brand">{names.brands.get(note.originBrandId)?.name ?? "Deleted brand"}</Row> : note.origin === "LEARNED" ? <Row label="Brand">None (organization level)</Row> : null}
            <Row label="Niche">{note.niche === "general" ? "General (every niche)" : `${NICHE_LABELS[note.niche as "finance" | "health"] ?? note.niche} only`}</Row>
            <Row label="App / source">{sourceLabel(note.source)}</Row>
            {note.originSourceRef ? (
              <div>
                <dt className="text-muted">Source ref</dt>
                <dd className="break-all font-mono text-xs">{note.originSourceRef}</dd>
              </div>
            ) : null}
            {note.learnedAt ? <Row label="Last learned">{note.learnedAt.toISOString().slice(0, 16).replace("T", " ")} UTC</Row> : null}
            <Row label="Updated">{note.updatedAt.toISOString().slice(0, 10)}</Row>
            {p.where ? null : <Row label="Belongs to">Platform</Row>}
          </dl>
        </section>

        <section className="rounded-xl border border-line bg-white p-4" aria-labelledby="push-h">
          <h2 id="push-h" className="text-xs font-semibold uppercase tracking-wide text-muted">
            Push down to brands
          </h2>
          <p className="mt-1 text-xs text-muted">
            Chosen brands get this note in their Brain as a read-only “Best practices” note. They are not told where it came from. Never push a brand&apos;s private data, results or plans.
          </p>
          <p className="mt-2 text-sm">
            Now in <strong>{copies.length}</strong> brand Brain{copies.length === 1 ? "" : "s"}.
          </p>
          <form action={setPushDown} className="mt-3 space-y-3">
            <input type="hidden" name="noteId" value={note.id} />
            <fieldset className="space-y-1.5 text-sm">
              <legend className="sr-only">Who gets this note</legend>
              {(
                [
                  ["NONE", "Not pushed"],
                  ["ALL", note.niche === "general" ? "All brands (including new ones)" : `All ${note.niche} brands (including new ones)`],
                  ["SELECTED", "Only the brands ticked below"],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="flex min-h-9 items-center gap-2">
                  <input type="radio" name="pushScope" value={value} defaultChecked={note.pushScope === value} /> {label}
                </label>
              ))}
            </fieldset>
            <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border border-line p-2">
              {note.niche !== "general" ? <p className="text-xs text-muted">Only {note.niche} brands are listed: this note never reaches another niche.</p> : null}
              {orgs
                .map((item) => ({ ...item, brands: item.brands.filter((brand) => noteFitsBrand(note.niche, brand.niche)) }))
                .filter((item) => item.brands.length > 0)
                .map((item) => (
                <fieldset key={item.id}>
                  <legend className="text-xs font-semibold text-muted">
                    {item.name}
                    {item.suspendedAt ? " (suspended)" : ""}
                  </legend>
                  {item.brands.length === 0 ? <p className="text-xs text-muted">No brands</p> : null}
                  {item.brands.map((brand) => (
                    <label key={brand.id} className="flex min-h-9 items-center gap-2 text-sm">
                      <input type="checkbox" name="brandId" value={brand.id} defaultChecked={selected.has(brand.id)} />
                      <span className="min-w-0 break-words">{brand.name}</span>
                      {copyBrands.has(brand.id) ? <Badge tone="ok">has it</Badge> : null}
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
            <Button type="submit" className="w-full">
              Save push-down
            </Button>
          </form>
        </section>

        <section className="rounded-xl border border-line bg-white p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Attachments · {note.attachments.length}</h2>
          <ul className="mt-2 space-y-1.5">
            {note.attachments.map((file) => (
              <li key={file.id} className="flex items-center justify-between gap-2 text-sm">
                <a href={`/brain/files/${file.id}`} className="min-w-0 break-all text-accent hover:underline">
                  {file.filename}
                </a>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
                  {size(file.size)}
                  <form action={deleteMainAttachment}>
                    <input type="hidden" name="noteId" value={note.id} />
                    <input type="hidden" name="attachmentId" value={file.id} />
                    <button type="submit" className="min-h-8 px-1 text-[#b42318] hover:underline">
                      Remove
                    </button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
          <form action={uploadMainAttachment} className="mt-3 space-y-2 border-t border-line pt-3">
            <input type="hidden" name="noteId" value={note.id} />
            <label htmlFor="main-attach" className="text-sm font-semibold">
              Attach an image or file
            </label>
            <input id="main-attach" name="file" type="file" required className="block w-full text-sm file:mr-2 file:rounded-md file:border-0 file:bg-canvas file:px-3 file:py-2 file:text-sm" />
            <Button type="submit" variant="secondary" className="w-full">
              Attach
            </Button>
          </form>
        </section>

        <section className="rounded-xl border border-line bg-white p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Linked from · {linksIn.length}</h2>
          {linksIn.length === 0 ? <p className="mt-2 text-sm text-muted">No main-Brain notes link here.</p> : null}
          <ul className="mt-2 space-y-1">
            {linksIn.slice(0, 40).map((row) => (
              <li key={row.id}>
                <Link href={`/brain/${row.id}`} className="block break-words text-sm text-accent hover:underline">
                  {row.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-3 rounded-xl border border-line bg-white p-4">
          <Link href={`/brain/${note.id}/edit`} className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-accent px-3 text-sm font-semibold text-white">
            Edit note
          </Link>
          <details className="border-t border-line pt-3">
            <summary className="cursor-pointer text-sm font-semibold text-[#b42318]">Delete…</summary>
            <form action={deleteMainNote} className="mt-2 space-y-2">
              <input type="hidden" name="noteId" value={note.id} />
              <p className="text-xs text-muted">Removes it from the main Brain and withdraws it from every brand it was pushed to. Brand Brains keep their own copy of what they were taught.</p>
              <Button type="submit" variant="danger" className="w-full">
                Delete from the main Brain
              </Button>
            </form>
          </details>
        </section>
      </aside>
    </div>
  );
}
