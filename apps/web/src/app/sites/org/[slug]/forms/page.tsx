import { Badge, Button, Input, Label } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { TableScroll } from "@/components/table-scroll";
import { createFolder, createForm, deleteFolder, updateFolder } from "@/features/forms/actions";
import { listFolders, listForms, listThemes } from "@/features/forms/data";
import { formsAccess } from "@/features/forms/guard";
import { STARTERS } from "../../../../../../../../modules/forms/starters";

const STATUS_TONE = { DRAFT: "neutral", OPEN: "ok", CLOSED: "warn" } as const;
const STATUS_LABEL = { DRAFT: "Draft", OPEN: "Live", CLOSED: "Closed" } as const;

export default async function FormsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ folder?: string; q?: string; error?: string; notice?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await formsAccess(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx, canWrite } = access;
  const folderId = query.folder ?? null;
  const [forms, folders, themes] = await Promise.all([
    listForms(ctx.resolved.id, ctx.brand.id, folderId, query.q ?? ""),
    listFolders(ctx.resolved.id, ctx.brand.id),
    listThemes(ctx.resolved.id, ctx.brand.id),
  ]);
  const activeFolder = folders.find((folder) => folder.id === folderId) ?? null;
  const folderName = new Map(folders.map((folder) => [folder.id, folder.name]));
  const folderLink = (id: string | null, label: string) => (
    <Link
      href={id ? `/forms?folder=${id}` : "/forms"}
      className={`block truncate rounded-md px-3 py-2 text-sm ${folderId === id ? "bg-[#eef2ff] font-semibold text-[#1e3a8a]" : "hover:bg-canvas"}`}
    >
      {label}
    </Link>
  );

  return (
    <div>
      <PageHeader title="Forms" description={`Surveys and forms for ${ctx.brand.name}, with branching, public links, results and exports.`} />
      <Flash error={query.error} notice={query.notice} />
      {themes.length === 0 && canWrite ? (
        <p className="mb-4 rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
          Before you publish, <Link href="/forms/themes" className="font-semibold underline">create a theme</Link> with your logo and privacy-policy link. Every public form shows it.
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="space-y-3">
          <nav className="rounded-xl border border-line bg-white p-2" aria-label="Folders">
            {folderLink(null, "All forms")}
            {folders.map((folder) => folderLink(folder.id, folder.name))}
            {folderLink("unfiled", "Unfiled")}
          </nav>
          {canWrite ? (
            <form action={createFolder} className="flex gap-2">
              <input name="name" aria-label="New folder name" placeholder="New folder" maxLength={80} className="pc-control min-w-0 flex-1 text-sm" />
              <Button type="submit" variant="secondary" size="sm">
                Add
              </Button>
            </form>
          ) : null}
          <Link href="/forms/themes" className="block rounded-xl border border-line bg-white px-3 py-2.5 text-sm font-semibold text-accent">
            Themes · {themes.length}
          </Link>
        </aside>

        <div className="min-w-0 space-y-4">
          {canWrite ? (
            <details className="rounded-xl border border-line bg-white" open={forms.length === 0}>
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-accent">+ New form</summary>
              <form action={createForm} className="space-y-4 border-t border-line p-4">
                <div>
                  <Label htmlFor="new-title">Title</Label>
                  <Input id="new-title" name="title" maxLength={200} required placeholder="What is this form for?" />
                </div>
                <fieldset>
                  <legend className="mb-1 text-sm font-medium">Start from</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {STARTERS.map((starter, index) => (
                      <label key={starter.key} className="flex cursor-pointer items-start gap-2 rounded-lg border border-line p-3 text-sm has-[:checked]:border-accent has-[:checked]:bg-[#eef2ff]">
                        <input type="radio" name="starter" value={starter.key} defaultChecked={index === 0} className="mt-1 accent-accent" />
                        <span>
                          <span className="block font-semibold">{starter.name}</span>
                          <span className="block text-muted">{starter.description}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                {folders.length ? (
                  <div>
                    <Label htmlFor="new-folder">Folder</Label>
                    <select id="new-folder" name="folderId" defaultValue={activeFolder?.id ?? ""} className="pc-control w-full text-sm">
                      <option value="">Unfiled</option>
                      {folders.map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {folder.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
                <Button type="submit" className="w-full sm:w-auto">
                  Create and open the builder
                </Button>
              </form>
            </details>
          ) : null}

          <form action="/forms" className="flex gap-2">
            {folderId ? <input type="hidden" name="folder" value={folderId} /> : null}
            <input name="q" defaultValue={query.q ?? ""} aria-label="Search forms" placeholder="Search forms" className="pc-control min-w-0 flex-1 text-sm" />
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </form>

          <div className="rounded-xl border border-line bg-white">
            <TableScroll>
              <table className="w-full min-w-[560px] text-sm">
                <thead className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                  <tr>
                    <th className="px-4 py-2.5">Form</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5 text-right">Responses</th>
                    <th className="px-4 py-2.5">Updated</th>
                    <th className="px-4 py-2.5" aria-label="Links" />
                  </tr>
                </thead>
                <tbody>
                  {forms.map((form) => (
                    <tr key={form.id} className="border-b border-line last:border-0">
                      <td className="max-w-[320px] px-4 py-3">
                        <Link href={`/forms/${form.id}`} className="[overflow-wrap:anywhere] font-semibold text-ink hover:text-accent">
                          {form.title}
                        </Link>
                        <span className="block truncate text-xs text-muted">
                          /f/{form.slug}
                          {form.internalName ? ` · ${form.internalName}` : ""}
                          {form.folderId && !folderId ? ` · ${folderName.get(form.folderId) ?? ""}` : ""}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={STATUS_TONE[form.status]}>{STATUS_LABEL[form.status]}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{form.responses}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted">{form.updatedAt.toISOString().slice(0, 10)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <Link href={`/forms/${form.id}/results`} className="font-semibold text-accent">
                          Results
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {forms.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted">
                        {query.q ? "No forms match." : "No forms here yet."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </TableScroll>
          </div>

          {activeFolder && canWrite ? (
            <details className="rounded-xl border border-line bg-white">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Folder settings</summary>
              <div className="space-y-3 border-t border-line p-4">
                <form action={updateFolder} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                  <input type="hidden" name="folderId" value={activeFolder.id} />
                  <div>
                    <Label htmlFor="folder-name">Name</Label>
                    <Input id="folder-name" name="name" defaultValue={activeFolder.name} maxLength={80} />
                  </div>
                  <div>
                    <Label htmlFor="folder-theme">Theme for new forms</Label>
                    <select id="folder-theme" name="defaultThemeId" defaultValue={activeFolder.defaultThemeId ?? ""} className="pc-control w-full text-sm">
                      <option value="">Brand default</option>
                      {themes.map((theme) => (
                        <option key={theme.id} value={theme.id}>
                          {theme.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button type="submit" variant="secondary">
                    Save folder
                  </Button>
                </form>
                <form action={deleteFolder}>
                  <input type="hidden" name="folderId" value={activeFolder.id} />
                  <Button type="submit" variant="danger" size="sm">
                    Delete folder (forms move to Unfiled)
                  </Button>
                </form>
              </div>
            </details>
          ) : null}
        </div>
      </div>
    </div>
  );
}
