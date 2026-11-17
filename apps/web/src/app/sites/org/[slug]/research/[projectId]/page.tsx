import { aiConfigured } from "@pubcommand/ai";
import { Badge, Button, Input, Label, Textarea } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyLink } from "@/features/research/copy-link";
import { Flash } from "@/components/ui";
import { addShare, addSource, deleteProject, deleteSource, removeShare, renameGroup, rerunSource, setBrainSharing, setPublicLink, suggestGroups, updateProject } from "@/features/research/actions";
import { AutoRefresh } from "@/features/research/auto-refresh";
import { CardItem, NewCardForm } from "@/features/research/cards";
import { canEdit, canManage, projectFor, researchContext } from "@/features/research/context";
import { isBusy, isStale, loadProjectContents, memberEmails, memberNames, type CardView } from "@/features/research/data";
import { IngestForm } from "@/features/research/ingest-form";
import { OutlineBoard } from "@/features/research/outline-board";

const ACCESS_LABEL = { owner: "Owner", admin: "Admin", edit: "Can edit", view: "View only", none: "" } as const;
const KIND_LABEL: Record<string, string> = { text: "Pasted", url: "Web", file: "File", youtube: "YouTube" };

function StatusBadge({ status, stale }: { status: string; stale: boolean }) {
  if (stale) return <Badge tone="danger">Interrupted</Badge>;
  if (status === "DONE") return <Badge tone="ok">Done</Badge>;
  if (status === "FAILED") return <Badge tone="danger">Failed</Badge>;
  return <Badge tone="warn">{status === "RUNNING" ? "Extracting…" : "Queued"}</Badge>;
}

export default async function ResearchProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; projectId: string }>;
  searchParams: Promise<{ tab?: string; group?: string; tag?: string; add?: string; error?: string; notice?: string }>;
}) {
  const { slug, projectId } = await params;
  const query = await searchParams;
  const context = await researchContext(slug);
  if (!context.ok) notFound();
  const { viewer } = context;
  const found = await projectFor(viewer, projectId);
  if (!found) notFound();
  const { project, access } = found;
  const editable = canEdit(access);
  const manage = canManage(access);
  const tab = query.tab === "outline" || (query.tab === "settings" && manage) ? query.tab : "research";
  const { sources, cards, outline } = await loadProjectContents(viewer.organizationId, project.id);
  const owner = project.ownerId === viewer.userId ? "you" : ((await memberNames(viewer.organizationId, [project.ownerId])).get(project.ownerId) ?? "a former member");

  const sourceBusy = sources.some((source) => isBusy(source.status) && !isStale(source.status, source.updatedAt));
  const groupBusy = isBusy(project.groupStatus) && !isStale(project.groupStatus, project.updatedAt);
  const groups = [...new Set(cards.map((card) => card.groupName).filter((name): name is string => Boolean(name)))].sort();
  const tags = [...new Set(cards.flatMap((card) => card.tags))].sort();
  const sourceTitles = new Map(sources.map((source) => [source.id, source.title]));
  const filtered = cards.filter((card) => (!query.group || (query.group === "__none" ? !card.groupName : card.groupName === query.group)) && (!query.tag || card.tags.includes(query.tag)));
  const piles = new Map<string, CardView[]>();
  for (const card of filtered) piles.set(card.groupName || "", [...(piles.get(card.groupName || "") ?? []), card]);
  const pileOrder = [...piles.keys()].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
  const tabs = [["research", `Research · ${cards.length}`], ["outline", "Outline"], ...(manage ? [["settings", "Sharing & settings"]] : [])];

  return (
    <div className="space-y-4">
      <nav className="text-sm">
        <Link href="/research" className="text-accent hover:underline">
          ← All projects
        </Link>
      </nav>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="pc-break text-2xl font-semibold tracking-tight">{project.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>Owned by {owner}</span>
            <Badge>{ACCESS_LABEL[access]}</Badge>
            {project.shares.length ? <Badge>Shared with {project.shares.length}</Badge> : <Badge>Private</Badge>}
            {project.publicEnabled ? <Badge tone="warn">Public link on</Badge> : null}
            {project.shareWithBrain ? <Badge tone="accent">Teaches the Brain</Badge> : null}
          </p>
          {project.description ? <p className="pc-break mt-2 max-w-3xl text-sm">{project.description}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`/research/${project.id}/export?format=docx`} className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold hover:bg-canvas">
            Word
          </a>
          <a href={`/research/${project.id}/export?format=md`} className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold hover:bg-canvas">
            Markdown
          </a>
        </div>
      </header>

      <Flash error={query.error} notice={query.notice} />

      <nav className="-mx-1 flex gap-1 overflow-x-auto border-b border-line" aria-label="Project sections">
        {tabs.map(([key, label]) => (
          <Link
            key={key}
            href={`/research/${project.id}${key === "research" ? "" : `?tab=${key}`}`}
            className={`inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm font-medium ${tab === key ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"}`}
          >
            {label}
          </Link>
        ))}
      </nav>

      {tab === "research" ? (
        <div className="space-y-5">
          {editable ? (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="min-w-0">
                <h2 className="mb-2 text-sm font-semibold">Add a source</h2>
                <IngestForm projectId={project.id} action={addSource} initialKind={query.add} />
                {!aiConfigured() ? <p className="mt-2 text-xs text-[#93370d]">The AI key is not set: sources are saved, but cards will not be extracted until it is.</p> : null}
              </div>
              <div className="min-w-0">
                <SourceList sources={sources} projectId={project.id} editable={editable} />
              </div>
            </div>
          ) : (
            <SourceList sources={sources} projectId={project.id} editable={false} />
          )}
          {sourceBusy || groupBusy ? (
            <div className="flex items-center gap-3 rounded-xl border border-[#c7d7fe] bg-[#eef4ff] px-4 py-3 text-sm text-[#1e3a8a]">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-[#1e3a8a] border-t-transparent" aria-hidden />
              {groupBusy ? "Sorting cards into topic groups…" : "Reading sources and writing cards… usually under a minute."} This page updates by itself. <AutoRefresh />
            </div>
          ) : null}
          {project.groupStatus === "FAILED" && project.groupError ? (
            <p className="rounded-md border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm text-[#912018]">Grouping failed: {project.groupError}</p>
          ) : null}

          <section>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Index cards</h2>
              {editable && cards.length > 1 ? (
                <form action={suggestGroups}>
                  <input type="hidden" name="projectId" value={project.id} />
                  <Button type="submit" variant="secondary" disabled={groupBusy}>
                    {groups.length ? "Re-suggest topic groups" : "Suggest topic groups"}
                  </Button>
                </form>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-muted">Facts and quotes are copied from the source by the AI. Check each one against the source before you use it.</p>
            {groups.length || tags.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5 text-xs" aria-label="Filter cards">
                <FilterChip href={`/research/${project.id}`} active={!query.group && !query.tag} label="All" />
                {groups.map((group) => (
                  <FilterChip key={group} href={`/research/${project.id}?group=${encodeURIComponent(group)}`} active={query.group === group} label={group} />
                ))}
                {groups.length && cards.some((card) => !card.groupName) ? <FilterChip href={`/research/${project.id}?group=__none`} active={query.group === "__none"} label="Ungrouped" /> : null}
                {tags.slice(0, 30).map((tag) => (
                  <FilterChip key={tag} href={`/research/${project.id}?tag=${encodeURIComponent(tag)}`} active={query.tag === tag} label={`#${tag}`} muted />
                ))}
              </div>
            ) : null}

            {pileOrder.map((pile) => (
              <div key={pile || "none"} className="mt-5">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h3 className="pc-break text-sm font-semibold uppercase tracking-wide text-muted">
                    {pile || (groups.length ? "Ungrouped" : "All cards")} · {piles.get(pile)!.length}
                  </h3>
                  {editable && pile ? (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-accent">Rename</summary>
                      <form action={renameGroup} className="mt-1 flex gap-1">
                        <input type="hidden" name="projectId" value={project.id} />
                        <input type="hidden" name="from" value={pile} />
                        <input name="to" defaultValue={pile} maxLength={60} aria-label={`Rename group ${pile}`} className="pc-control w-44 text-xs" />
                        <Button type="submit" variant="secondary" size="sm">
                          Save
                        </Button>
                      </form>
                    </details>
                  ) : null}
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {piles.get(pile)!.map((card) => (
                    <CardItem key={card.id} card={card} projectId={project.id} groups={groups} editable={editable} sourceTitle={card.sourceId ? sourceTitles.get(card.sourceId) : undefined} />
                  ))}
                </div>
              </div>
            ))}
            {cards.length === 0 ? <p className="mt-3 rounded-xl border border-line bg-white p-6 text-sm text-muted">No cards yet. Add a source and the AI writes 5 to 15 index cards from it.</p> : null}
            {cards.length > 0 && filtered.length === 0 ? <p className="mt-3 text-sm text-muted">No cards match that filter.</p> : null}
          </section>
          {editable ? <NewCardForm projectId={project.id} groups={groups} open={query.add === "card"} /> : null}
        </div>
      ) : null}

      {tab === "outline" ? (
        <OutlineBoard
          projectId={project.id}
          editable={editable}
          outline={outline}
          cards={cards.map((card) => ({ id: card.id, topic: card.topic, summary: card.summary, cardType: card.cardType, groupName: card.groupName }))}
        />
      ) : null}

      {tab === "settings" && manage ? <SettingsTab project={project} origin={viewer.origin} members={await memberEmails(viewer.organizationId)} brandName={viewer.brand.name} /> : null}
    </div>
  );
}

function FilterChip({ href, active, label, muted }: { href: string; active: boolean; label: string; muted?: boolean }) {
  return (
    <Link href={href} className={`inline-flex min-h-9 items-center rounded-full border px-3 ${active ? "border-accent bg-[#eef4ff] text-accent" : `border-line bg-white ${muted ? "text-muted" : ""} hover:border-accent`}`}>
      <span className="pc-break">{label}</span>
    </Link>
  );
}

type SourceRow = Awaited<ReturnType<typeof loadProjectContents>>["sources"][number];

function SourceList({ sources, projectId, editable }: { sources: SourceRow[]; projectId: string; editable: boolean }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold">Sources · {sources.length}</h2>
      {sources.length === 0 ? <p className="rounded-xl border border-line bg-white p-4 text-sm text-muted">Nothing added yet.</p> : null}
      <ul className="space-y-2">
        {sources.map((source) => {
          const stale = isStale(source.status, source.updatedAt);
          return (
            <li key={source.id} className="rounded-xl border border-line bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="pc-break text-sm font-medium">
                    {source.sourceRef && /^https?:\/\//.test(source.sourceRef) ? (
                      <a href={source.sourceRef} target="_blank" rel="noreferrer noopener" className="hover:text-accent">
                        {source.title}
                      </a>
                    ) : (
                      source.title
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {KIND_LABEL[source.kind] ?? source.kind}
                    {source.inputType === "scanned-pdf" ? " · scanned PDF" : ""} · {source.createdAt.toISOString().slice(0, 10)}
                    {source.status === "DONE" ? ` · ${source.cardCount} cards` : ""}
                  </p>
                </div>
                <StatusBadge status={source.status} stale={stale} />
              </div>
              {source.summary ? <p className="pc-break mt-2 text-xs text-muted">{source.summary}</p> : null}
              {source.status === "FAILED" && source.error ? <p className="pc-break mt-2 text-xs text-[#912018]">{source.error}</p> : null}
              {editable && (!isBusy(source.status) || stale) ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <form action={rerunSource}>
                    <input type="hidden" name="projectId" value={projectId} />
                    <input type="hidden" name="sourceId" value={source.id} />
                    <Button type="submit" variant="secondary" size="sm">
                      {source.status === "DONE" ? "Extract again" : "Extract"}
                    </Button>
                  </form>
                  <form action={deleteSource}>
                    <input type="hidden" name="projectId" value={projectId} />
                    <input type="hidden" name="sourceId" value={source.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      Remove
                    </Button>
                  </form>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function SettingsTab({
  project,
  origin,
  members,
  brandName,
}: {
  project: NonNullable<Awaited<ReturnType<typeof projectFor>>>["project"];
  origin: string;
  members: string[];
  brandName: string;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="min-w-0 space-y-3 rounded-xl border border-line bg-white p-4">
        <h2 className="font-semibold">Share with teammates</h2>
        <p className="text-sm text-muted">Projects are private to the owner. Workspace admins can always see them. Share by email, even before a teammate first signs in.</p>
        <form action={addShare} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <input type="hidden" name="projectId" value={project.id} />
          <input name="email" type="email" required list="research-members" placeholder="teammate@company.com" aria-label="Teammate email" className="pc-control min-w-0 text-sm" />
          <datalist id="research-members">
            {members.map((email) => (
              <option key={email} value={email} />
            ))}
          </datalist>
          <select name="permission" className="pc-control text-sm" aria-label="Permission" defaultValue="view">
            <option value="view">Can view</option>
            <option value="edit">Can edit</option>
          </select>
          <Button type="submit">Share</Button>
        </form>
        <ul className="divide-y divide-line text-sm">
          {project.shares.map((share) => (
            <li key={share.id} className="flex items-center justify-between gap-2 py-2">
              <span className="pc-break min-w-0">
                {share.email} <span className="text-xs text-muted">· {share.permission === "edit" ? "can edit" : "can view"}</span>
              </span>
              <form action={removeShare}>
                <input type="hidden" name="projectId" value={project.id} />
                <input type="hidden" name="shareId" value={share.id} />
                <Button type="submit" variant="ghost" size="sm">
                  Remove
                </Button>
              </form>
            </li>
          ))}
          {project.shares.length === 0 ? <li className="py-2 text-muted">Not shared with anyone.</li> : null}
        </ul>
      </section>

      <section className="min-w-0 space-y-3 rounded-xl border border-line bg-white p-4">
        <h2 className="font-semibold">Public read-only link</h2>
        <p className="text-sm text-muted">Anyone with the link can read the outline and cards without signing in. Source files and uploads are never shown.</p>
        {project.publicEnabled && project.publicToken ? <CopyLink label="Public link" url={`${origin}/p/research/${project.publicToken}`} /> : null}
        <div className="flex flex-wrap gap-2">
          {project.publicEnabled ? (
            <>
              <form action={setPublicLink}>
                <input type="hidden" name="projectId" value={project.id} />
                <input type="hidden" name="mode" value="disable" />
                <Button type="submit" variant="secondary">
                  Turn off
                </Button>
              </form>
              <form action={setPublicLink}>
                <input type="hidden" name="projectId" value={project.id} />
                <input type="hidden" name="mode" value="regenerate" />
                <Button type="submit" variant="ghost">
                  New link (old one stops working)
                </Button>
              </form>
            </>
          ) : (
            <form action={setPublicLink}>
              <input type="hidden" name="projectId" value={project.id} />
              <input type="hidden" name="mode" value="enable" />
              <Button type="submit" variant="secondary">
                Make a public link
              </Button>
            </form>
          )}
        </div>
      </section>

      <section className="min-w-0 space-y-3 rounded-xl border border-line bg-white p-4">
        <h2 className="font-semibold">Share cards with the Brain</h2>
        <p className="text-sm text-muted">
          Off by default: research stays in this project. Turn it on to keep one note in the {brandName} Brain with this project&apos;s cards, updated as they change. Turning it off removes that note.
        </p>
        <form action={setBrainSharing} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="projectId" value={project.id} />
          <label className="inline-flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" name="shareWithBrain" defaultChecked={project.shareWithBrain} className="h-5 w-5" />
            Share cards with the Brain
          </label>
          <Button type="submit" variant="secondary">
            Save
          </Button>
        </form>
      </section>

      <section className="min-w-0 space-y-3 rounded-xl border border-line bg-white p-4">
        <h2 className="font-semibold">Project</h2>
        <form action={updateProject} className="space-y-3">
          <input type="hidden" name="projectId" value={project.id} />
          <div>
            <Label htmlFor="settings-name">Name</Label>
            <Input id="settings-name" name="name" required maxLength={160} defaultValue={project.name} />
          </div>
          <div>
            <Label htmlFor="settings-description">Brief</Label>
            <Textarea id="settings-description" name="description" rows={3} maxLength={2000} defaultValue={project.description} />
          </div>
          <Button type="submit">Save</Button>
        </form>
        <details className="border-t border-line pt-3">
          <summary className="cursor-pointer text-sm font-semibold text-[#b42318]">Delete project</summary>
          <form action={deleteProject} className="mt-2 space-y-2">
            <input type="hidden" name="projectId" value={project.id} />
            <Label htmlFor="settings-confirm">Type the project name to confirm</Label>
            <Input id="settings-confirm" name="confirm" required autoComplete="off" />
            <Button type="submit" variant="danger">
              Delete project
            </Button>
          </form>
        </details>
      </section>
    </div>
  );
}
