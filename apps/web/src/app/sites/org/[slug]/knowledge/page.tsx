import { Button, Input } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { askBrain } from "@/features/brain/actions";
import { brainHref, loadBrain } from "@/features/brain/context";
import { notesInFolder, recentNotes, sharedNotes } from "@/features/brain/notes";
import { NoteList } from "@/features/brain/parts";
import { folderCounts, searchNotes } from "@/features/brain/search";
import { buildFolderTree, folderAncestors, normalizeFolder, type FolderNode } from "../../../../../../../../modules/knowledge/folders";

function findNode(nodes: FolderNode[], path: string): FolderNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    const child = findNode(node.children, path);
    if (child) return child;
  }
  return null;
}

export default async function BrainHome({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ scope?: string; q?: string; folder?: string; shared?: string; error?: string; notice?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const loaded = await loadBrain(slug, query.scope);
  if (loaded.kind === "missing") notFound();
  if (loaded.kind === "denied") return <Denied title={loaded.title} />;
  const { ctx } = loaded;
  const scope = ctx.brain;
  const orgId = ctx.resolved.id;
  const q = (query.q ?? "").trim().slice(0, 300);
  const folder = normalizeFolder(query.folder);
  const showShared = query.shared === "1";

  const hits = q ? await searchNotes({ organizationId: orgId, scope, query: q, folder, limit: 50 }) : [];
  const folderNode = folder && !q ? findNode(buildFolderTree(await folderCounts(orgId, scope)), folder) : null;
  const inFolder = folder && !q ? await notesInFolder(orgId, scope, folder) : [];
  const recent = !q && !folder && !showShared ? await recentNotes(orgId, scope, 20) : [];
  const shared = showShared ? await sharedNotes(orgId, scope) : [];
  const scopeInput = scope.kind === "main" ? <input type="hidden" name="scope" value="main" /> : null;

  return (
    <div className="max-w-4xl">
      <h1 className="break-words text-2xl font-semibold tracking-tight">{ctx.scopeLabel}</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        {scope.kind === "main"
          ? "What every brand has learned, in one place. Brand notes stay private to their brand unless an admin shares them."
          : "Notes this brand's apps and team have taught it, plus best practices shared with every brand."}
      </p>
      <div className="mt-4">
        <Flash error={query.error} notice={query.notice} />
      </div>

      <form action="/knowledge" className="pc-form-row">
        {scopeInput}
        {folder ? <input type="hidden" name="folder" value={folder} /> : null}
        <Input name="q" defaultValue={q} placeholder={folder ? `Search in ${folder}` : "Search titles and notes"} aria-label="Search the Brain" className="sm:flex-1" />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {q ? (
        <section className="mt-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            {hits.length} {hits.length === 1 ? "match" : "matches"} for “{q}”{folder ? ` in ${folder}` : ""}
          </h2>
          <NoteList notes={hits} scope={scope} brandNames={ctx.brandNames} empty="No notes match. Try fewer or different words." snippets={new Map(hits.map((hit) => [hit.id, hit.snippet]))} />
        </section>
      ) : folder ? (
        <section className="mt-6">
          <nav className="mb-2 flex flex-wrap items-center gap-1 text-sm text-muted" aria-label="Folder">
            <Link href={brainHref("/knowledge", scope)} className="hover:text-ink">
              All
            </Link>
            {folderAncestors(folder).map((path) => (
              <span key={path} className="flex min-w-0 items-center gap-1">
                <span aria-hidden>/</span>
                <Link href={brainHref("/knowledge", scope, { folder: path })} className="break-all hover:text-ink">
                  {path.split("/").pop()}
                </Link>
              </span>
            ))}
          </nav>
          {folderNode && folderNode.children.length > 0 ? (
            <ul className="mb-4 flex flex-wrap gap-2">
              {folderNode.children.map((child) => (
                <li key={child.path}>
                  <Link href={brainHref("/knowledge", scope, { folder: child.path })} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm hover:bg-canvas">
                    <span className="break-all">{child.name}</span>
                    <span className="text-xs text-muted">{child.total}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          <NoteList notes={inFolder} scope={scope} brandNames={ctx.brandNames} empty="No notes directly in this folder." />
          {ctx.canWrite ? (
            <Link href={brainHref("/knowledge/new", scope, { folder })} className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-accent">
              + New note in {folder.split("/").pop()}
            </Link>
          ) : null}
        </section>
      ) : showShared ? (
        <section className="mt-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Shared with every brand</h2>
          <NoteList notes={shared} scope={scope} brandNames={ctx.brandNames} empty="Nothing is shared yet. An admin can share a generic best-practice note from its page." />
        </section>
      ) : (
        <>
          <form action={askBrain} className="mt-6 rounded-xl border border-line bg-white p-4">
            {scopeInput}
            <label htmlFor="brain-question" className="text-sm font-semibold">
              Ask the Brain
            </label>
            <p className="mt-0.5 text-xs text-muted">Answers come only from notes in {ctx.scopeLabel}, with links to the notes used.</p>
            <div className="pc-form-row mt-2">
              <Input id="brain-question" name="question" required minLength={3} maxLength={1000} placeholder="e.g. What makes our best headlines work?" className="sm:flex-1" />
              <Button type="submit">Ask</Button>
            </div>
          </form>
          <section className="mt-6">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Recently updated</h2>
              <Link href={brainHref("/knowledge", scope, { shared: "1" })} className="text-xs font-semibold text-accent">
                Shared with every brand →
              </Link>
            </div>
            <NoteList
              notes={recent}
              scope={scope}
              brandNames={ctx.brandNames}
              empty={ctx.canWrite ? "This Brain is empty. Write a note, import a vault, or let the apps teach it." : "This Brain is empty so far."}
            />
          </section>
        </>
      )}
    </div>
  );
}
