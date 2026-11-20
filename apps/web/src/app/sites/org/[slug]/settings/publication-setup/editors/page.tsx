import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { pubsetupPage } from "@/features/pubsetup/guard";
import { EDITOR_ROLE_LABELS } from "@/features/pubsetup/module";
import { getEditors } from "@/features/pubsetup/read";
import { StatusBadge, imageUrl } from "@/features/pubsetup/ui";

export default async function EditorsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string; show?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await pubsetupPage(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx } = access;
  const showArchived = query.show === "archived";
  const all = await getEditors(ctx.resolved.id, ctx.brand.id, { includeArchived: true });
  const archivedCount = all.filter((e) => e.archived).length;
  const editors = all.filter((e) => e.archived === showArchived);
  return (
    <div className="space-y-4">
      <Flash error={query.error} notice={query.notice} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 text-sm">
          <Link href="/settings/publication-setup/editors" className={`inline-flex min-h-11 items-center rounded-md px-3 font-medium ${showArchived ? "text-muted hover:bg-white" : "bg-white text-ink shadow-sm"}`}>
            Current · {all.length - archivedCount}
          </Link>
          <Link href="/settings/publication-setup/editors?show=archived" className={`inline-flex min-h-11 items-center rounded-md px-3 font-medium ${showArchived ? "bg-white text-ink shadow-sm" : "text-muted hover:bg-white"}`}>
            Archived · {archivedCount}
          </Link>
        </div>
        <Link href="/settings/publication-setup/editors/new" className="inline-flex min-h-11 items-center rounded-md bg-accent px-3.5 text-sm font-semibold text-white">
          + Add editor
        </Link>
      </div>
      <ul className="grid gap-3 md:grid-cols-2">
        {editors.map((editor) => (
          <li key={editor.id} className="min-w-0">
            <Link href={`/settings/publication-setup/editors/${editor.id}`} className="flex h-full min-w-0 gap-3 rounded-xl border border-line bg-white p-4 hover:border-accent">
              {editor.hasPhoto ? (
                <img src={imageUrl("editor-photo", editor.id, editor.updatedAt)} alt="" className="h-12 w-12 shrink-0 rounded-full border border-line object-cover" />
              ) : (
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-canvas text-sm font-bold text-muted" aria-hidden>
                  {editor.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold [overflow-wrap:anywhere]">{editor.name}</span>
                  {editor.status !== "active" || editor.archived ? <StatusBadge status={editor.status} archived={editor.archived} /> : null}
                </span>
                {editor.title ? <span className="block text-sm text-muted">{editor.title}</span> : null}
                <span className="mt-1 block text-xs text-muted [overflow-wrap:anywhere]">
                  {editor.publications.length ? editor.publications.map((p) => `${p.code} (${EDITOR_ROLE_LABELS[p.role] ?? p.role})`).join(", ") : "Not on a publication yet"}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {editors.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-white p-6 text-center text-sm text-muted">{showArchived ? "Nothing archived." : "No editors yet. Add the experts who write your publications."}</p>
      ) : null}
    </div>
  );
}
