import { Button } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { linkEditor, setEditorArchived, unlinkEditor } from "@/features/pubsetup/actions";
import { pubsetupPage } from "@/features/pubsetup/guard";
import { EDITOR_ROLES, EDITOR_ROLE_LABELS } from "@/features/pubsetup/module";
import { getEditor, getPublications } from "@/features/pubsetup/read";
import { Detail, SafeLink, StatusBadge, imageUrl } from "@/features/pubsetup/ui";

export default async function EditorPage({ params, searchParams }: { params: Promise<{ slug: string; editorId: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug, editorId } = await params;
  const query = await searchParams;
  const access = await pubsetupPage(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx } = access;
  const editor = await getEditor(ctx.resolved.id, ctx.brand.id, editorId);
  if (!editor || editor.id !== editorId) notFound();
  const publications = await getPublications(ctx.resolved.id, ctx.brand.id);
  const onPubs = new Set(editor.publications.map((p) => p.id));
  const available = publications.filter((p) => !onPubs.has(p.id));

  return (
    <div className="space-y-5">
      <Link href={editor.archived ? "/publication-setup/editors?show=archived" : "/publication-setup/editors"} className="inline-flex min-h-11 items-center text-sm text-muted hover:text-ink">
        ← Editors
      </Link>
      <Flash error={query.error} notice={query.notice} />
      <header className="flex flex-wrap items-start gap-4 rounded-xl border border-line bg-white p-4">
        {editor.hasPhoto ? (
          <img src={imageUrl("editor-photo", editor.id, editor.updatedAt)} alt="" className="h-20 w-20 shrink-0 rounded-full border border-line object-cover" />
        ) : (
          <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-canvas text-xl font-bold text-muted" aria-hidden>
            {editor.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold [overflow-wrap:anywhere]">{editor.name}</h2>
            <StatusBadge status={editor.status} archived={editor.archived} />
          </div>
          {editor.title ? <p className="text-sm text-muted">{editor.title}</p> : null}
          <p className="mt-1 text-xs text-muted">URL name: {editor.slug}</p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Link href={`/publication-setup/editors/${editor.id}/edit`} className="inline-flex min-h-11 items-center rounded-md bg-accent px-3.5 text-sm font-semibold text-white">
            Edit
          </Link>
          <form action={setEditorArchived}>
            <input type="hidden" name="editorId" value={editor.id} />
            <input type="hidden" name="archive" value={editor.archived ? "0" : "1"} />
            <Button type="submit" variant={editor.archived ? "secondary" : "danger"}>
              {editor.archived ? "Restore" : "Archive"}
            </Button>
          </form>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
        <section className="min-w-0 rounded-xl border border-line bg-white p-4">
          <h3 className="mb-3 font-semibold">Profile</h3>
          <dl className="space-y-4">
            <Detail label="Short bio">{editor.shortBio}</Detail>
            <Detail label="Bio">{editor.longBio}</Detail>
            <Detail label="Credentials">{editor.credentials}</Detail>
            <Detail label="Track record summary">{editor.trackRecord}</Detail>
            <Detail label="Specialties">{editor.specialties.length ? editor.specialties.join(" · ") : null}</Detail>
            <Detail label="Voice and style">{editor.voiceNotes}</Detail>
            <Detail label="Email (internal)">{editor.email}</Detail>
            <Detail label="Links">
              {editor.socialLinks.length ? (
                <span className="flex flex-col gap-1">
                  {editor.socialLinks.map((l, i) => (
                    <SafeLink key={i} href={l.url}>
                      {l.label || l.url}
                    </SafeLink>
                  ))}
                </span>
              ) : null}
            </Detail>
          </dl>
          {!editor.shortBio && !editor.longBio ? <p className="text-sm text-muted">No bio yet.</p> : null}
        </section>
        <section className="min-w-0 rounded-xl border border-line bg-white p-4">
          <h3 className="mb-3 font-semibold">Writes for</h3>
          <ul className="divide-y divide-line">
            {editor.publications.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/publication-setup/publications/${p.id}`} className="min-w-0 font-medium [overflow-wrap:anywhere] hover:text-accent">
                  {p.name} <span className="text-xs text-muted">({p.code})</span>
                  <span className="block text-xs font-normal text-muted">{EDITOR_ROLE_LABELS[p.role] ?? p.role}</span>
                </Link>
                <form action={unlinkEditor}>
                  <input type="hidden" name="publicationId" value={p.id} />
                  <input type="hidden" name="editorId" value={editor.id} />
                  <input type="hidden" name="back" value="editor" />
                  <Button type="submit" variant="ghost" size="sm" aria-label={`Remove from ${p.name}`}>
                    Remove
                  </Button>
                </form>
              </li>
            ))}
            {editor.publications.length === 0 ? <li className="py-2 text-sm text-muted">Not on a publication yet.</li> : null}
          </ul>
          {available.length ? (
            <form action={linkEditor} className="mt-3 space-y-2 border-t border-line pt-3">
              <input type="hidden" name="editorId" value={editor.id} />
              <input type="hidden" name="back" value="editor" />
              <label htmlFor="add-pub" className="text-sm font-medium">
                Add to a publication
              </label>
              <select id="add-pub" name="publicationId" className="pc-control w-full" required>
                {available.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code})
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <select name="role" defaultValue="lead" className="pc-control" aria-label="Role">
                  {EDITOR_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {EDITOR_ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
                <Button type="submit" size="sm">
                  Add
                </Button>
              </div>
            </form>
          ) : null}
        </section>
      </div>
    </div>
  );
}
