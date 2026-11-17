import { Button, Input } from "@pubcommand/ui";
import Link from "next/link";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { FolderTree } from "@/features/brain/parts";
import { listMainNotes, mainFolderCounts, mainStats, provenanceCounts, provenanceNames, searchMainNotes, type MainFilter } from "@/features/main-brain/notes";
import { MainNoteList } from "@/features/main-brain/parts";
import { brainStaff } from "@/features/main-brain/staff";
import { buildFolderTree, normalizeFolder } from "../../../../../../../modules/knowledge/folders";
import { sourceLabel } from "../../../../../../../modules/knowledge/visibility";

type Query = { q?: string; folder?: string; org?: string; brand?: string; app?: string; origin?: string; pushed?: string; error?: string; notice?: string };

const ORIGINS = ["LEARNED", "IMPORTED", "AUTHORED", "MIGRATED"] as const;

function hrefWith(query: Query, patch: Partial<Query>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...query, ...patch, error: undefined, notice: undefined })) if (value) params.set(key, value);
  const text = params.toString();
  return text ? `/brain?${text}` : "/brain";
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2">
      <p className="text-xl font-semibold tabular-nums">{value.toLocaleString()}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

export default async function MainBrainHome({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams;
  if (!(await brainStaff())) return <Denied />;
  const q = (query.q ?? "").trim().slice(0, 300);
  const folder = normalizeFolder(query.folder);
  const origin = (ORIGINS as readonly string[]).includes(query.origin ?? "") ? (query.origin as MainFilter["origin"]) : null;
  const filter: MainFilter = { folder, organizationId: query.org ?? null, brandId: query.brand ?? null, source: query.app ?? null, origin, pushed: query.pushed === "1" };
  const filtered = Boolean(folder || query.org || query.brand || query.app || origin || filter.pushed);
  const [stats, names, provenance, counts] = await Promise.all([mainStats(), provenanceNames(), provenanceCounts(), mainFolderCounts({ organizationId: filter.organizationId, brandId: filter.brandId, source: filter.source, origin: filter.origin, pushed: filter.pushed })]);
  const hits = q ? await searchMainNotes({ query: q, filter, limit: 60 }) : [];
  const notes = q ? hits : await listMainNotes(filter, { take: filtered ? 300 : 40, orderBy: folder ? "title" : "updated" });
  const tree = buildFolderTree(counts);
  const orgs = [...new Set(provenance.map((row) => row.originOrganizationId!).filter(Boolean))]
    .map((id) => ({ id, name: names.orgs.get(id)?.name ?? "Deleted organization", count: provenance.filter((row) => row.originOrganizationId === id).reduce((sum, row) => sum + row._count._all, 0) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const brands = provenance
    .filter((row) => row.originBrandId && (!query.org || row.originOrganizationId === query.org))
    .map((row) => ({ id: row.originBrandId!, name: names.brands.get(row.originBrandId!)?.name ?? "Deleted brand", org: names.orgs.get(row.originOrganizationId!)?.name ?? "", count: row._count._all }))
    .sort((a, b) => a.org.localeCompare(b.org) || a.name.localeCompare(b.name));

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Main Brain"
        description="Platform knowledge for PubCommand staff only. It learns from every note an app teaches a brand's Brain, and from vault imports. Organizations never see it; you decide which notes reach which brands as best practices."
      />
      <Flash error={query.error} notice={query.notice} />
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Notes" value={stats.total} />
        <Stat label="Learned from brands" value={stats.origin.LEARNED ?? 0} />
        <Stat label="Imported" value={stats.origin.IMPORTED ?? 0} />
        <Stat label="Written here" value={stats.origin.AUTHORED ?? 0} />
        <Stat label="Migrated" value={stats.origin.MIGRATED ?? 0} />
        <Stat label="Pushed down" value={stats.pushed} />
      </div>

      <form action="/brain" className="space-y-2 rounded-xl border border-line bg-white p-4">
        <div className="pc-form-row">
          <Input name="q" defaultValue={q} placeholder="Search titles and notes" aria-label="Search the main Brain" className="sm:flex-1" />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <select name="org" defaultValue={query.org ?? ""} className="pc-control" aria-label="Learned from organization">
            <option value="">Any organization</option>
            {orgs.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name} ({org.count})
              </option>
            ))}
          </select>
          <select name="brand" defaultValue={query.brand ?? ""} className="pc-control" aria-label="Learned from brand">
            <option value="">Any brand</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.org ? `${brand.org} · ` : ""}
                {brand.name} ({brand.count})
              </option>
            ))}
          </select>
          <select name="app" defaultValue={query.app ?? ""} className="pc-control" aria-label="Taught by app">
            <option value="">Any app or source</option>
            {stats.sources.map((row) => (
              <option key={row.source} value={row.source}>
                {sourceLabel(row.source)} ({row.count})
              </option>
            ))}
          </select>
          <select name="origin" defaultValue={origin ?? ""} className="pc-control" aria-label="How it got here">
            <option value="">Learned, imported or written</option>
            <option value="LEARNED">Learned from brands</option>
            <option value="IMPORTED">Imported</option>
            <option value="AUTHORED">Written here</option>
            <option value="MIGRATED">Migrated</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex min-h-9 items-center gap-2 text-sm">
            <input type="checkbox" name="pushed" value="1" defaultChecked={filter.pushed} /> Pushed down only
          </label>
          {folder ? <input type="hidden" name="folder" value={folder} /> : null}
          {filtered || q ? (
            <Link href="/brain" className="text-sm font-semibold text-accent">
              Clear filters
            </Link>
          ) : null}
        </div>
      </form>

      <div className="mt-5 grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="min-w-0">
          <details className="rounded-xl border border-line bg-white px-3 py-2 lg:hidden">
            <summary className="cursor-pointer py-1 text-sm font-semibold text-accent">Folders ({tree.length})</summary>
            <div className="mt-2 max-h-[50vh] overflow-y-auto">
              <FolderTree nodes={tree} hrefFor={(path) => hrefWith(query, { folder: path, q: undefined })} active={folder} />
            </div>
          </details>
          <div className="hidden rounded-xl border border-line bg-white px-2 py-3 lg:block">
            <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wider text-muted">Folders</p>
            <div className="max-h-[70vh] overflow-y-auto pr-1">
              <FolderTree nodes={tree} hrefFor={(path) => hrefWith(query, { folder: path, q: undefined })} active={folder} />
            </div>
          </div>
        </aside>
        <section className="min-w-0">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            {q ? `${hits.length} ${hits.length === 1 ? "match" : "matches"} for “${q}”` : filtered ? `${notes.length} notes${folder ? ` in ${folder}` : ""}` : "Recently updated"}
          </h2>
          <MainNoteList
            notes={notes}
            names={names}
            empty={q ? "No notes match. Try fewer or different words." : "No notes here yet. Apps teach brands, and learning flows up; or import a vault."}
            snippets={q ? new Map(hits.map((hit) => [hit.id, hit.snippet])) : undefined}
          />
        </section>
      </div>
    </div>
  );
}
