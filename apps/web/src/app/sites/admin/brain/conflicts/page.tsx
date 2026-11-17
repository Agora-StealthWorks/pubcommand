import { aiConfigured } from "@pubcommand/ai";
import { Badge, Button, Input } from "@pubcommand/ui";
import Link from "next/link";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { recheckAll, recheckEntity } from "@/features/brain-conflicts/actions";
import { AI_OFF_NOTE } from "@/features/brain-conflicts/check";
import { ConflictCard, kindLabel, placeText, Stat } from "@/features/brain-conflicts/parts";
import { conflictCounts, listChecks, listConflicts, STATUS_FILTERS } from "@/features/brain-conflicts/queries";
import { provenanceNames } from "@/features/main-brain/notes";
import { brainStaff } from "@/features/main-brain/staff";
import { AutoRefresh } from "@/features/promos/auto-refresh";

type Query = { status?: string; org?: string; brand?: string; kind?: string; layer?: string; q?: string; view?: string; error?: string; notice?: string };

function hrefWith(query: Query, patch: Partial<Query>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...query, ...patch, error: undefined, notice: undefined })) if (value) params.set(key, value);
  const text = params.toString();
  return text ? `/brain/conflicts?${text}` : "/brain/conflicts";
}

export default async function ConflictsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams;
  if (!(await brainStaff())) return <Denied />;
  const view = query.view === "entities" ? "entities" : "conflicts";
  const status = STATUS_FILTERS.some(([value]) => value === query.status) ? query.status! : "OPEN";
  const filter = { organizationId: query.org ?? null, brandId: query.brand ?? null, kind: query.kind ?? null, layer: query.layer ?? null, q: query.q ?? null };
  const [names, counts, rows, checks] = await Promise.all([
    provenanceNames(),
    conflictCounts(filter),
    view === "conflicts" ? listConflicts({ ...filter, status }) : Promise.resolve([]),
    view === "entities" ? listChecks(filter) : Promise.resolve([]),
  ]);
  const ai = aiConfigured();
  const total = (counts.status.OPEN ?? 0) + (counts.status.RESOLVED ?? 0) + (counts.status.DISMISSED ?? 0);
  const places = counts.places
    .map((p) => ({ ...p, label: placeText(names, p.organizationId, p.brandId) }))
    .sort((a, b) => b.OPEN - a.OPEN || a.label.localeCompare(b.label));
  const orgs = [...new Map(counts.places.map((p) => [p.organizationId, names.orgs.get(p.organizationId)?.name ?? "Deleted organization"])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const brands = counts.places.filter((p) => !query.org || p.organizationId === query.org).map((p) => [p.brandId, placeText(names, p.organizationId, p.brandId)] as const);

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Conflicts"
        description="Publication Setup is the source of truth about each publication and editor. This compares its facts with what the main Brain says and lists every contradiction to fix, flag or dismiss. Organizations never see this page."
      />
      <Flash error={query.error} notice={query.notice} />
      {!ai ? <p className="mb-4 rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">{AI_OFF_NOTE}</p> : null}
      {counts.running > 0 ? (
        <p className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm">
          Checking {counts.running} {counts.running === 1 ? "entity" : "entities"}… <AutoRefresh />
        </p>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Open" value={(counts.status.OPEN ?? 0) - counts.waiting} href={hrefWith(query, { status: "OPEN", view: undefined })} />
        <Stat label="Waiting on Setup" value={counts.waiting} href={hrefWith(query, { status: "WAITING", view: undefined })} />
        <Stat label="Resolved" value={counts.status.RESOLVED ?? 0} href={hrefWith(query, { status: "RESOLVED", view: undefined })} />
        <Stat label="Dismissed" value={counts.status.DISMISSED ?? 0} href={hrefWith(query, { status: "DISMISSED", view: undefined })} />
        <Stat label="Open · publications" value={counts.kinds.publication?.OPEN ?? 0} href={hrefWith(query, { kind: "publication", status: "OPEN", view: undefined })} />
        <Stat label="Open · editors" value={counts.kinds.editor?.OPEN ?? 0} href={hrefWith(query, { kind: "editor", status: "OPEN", view: undefined })} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form action={recheckAll}>
          <Button type="submit" variant="secondary">
            Re-check what changed
          </Button>
        </form>
        <form action={recheckAll}>
          <input type="hidden" name="force" value="1" />
          <Button type="submit" variant="secondary">
            Re-check everything
          </Button>
        </form>
        <p className="text-xs text-muted">
          {counts.checks} {counts.checks === 1 ? "entity" : "entities"} checked
          {counts.lastChecked?.checkedAt ? ` · last ${counts.lastChecked.checkedAt.toISOString().slice(0, 16).replace("T", " ")} UTC` : ""} · the job re-checks changed facts and notes hourly.
        </p>
      </div>

      <form action="/brain/conflicts" className="space-y-2 rounded-xl border border-line bg-white p-4">
        <input type="hidden" name="view" value={view === "entities" ? "entities" : ""} />
        <div className="pc-form-row">
          <Input name="q" defaultValue={query.q ?? ""} placeholder="Publication, editor or note" aria-label="Search conflicts" className="sm:flex-1" />
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {view === "conflicts" ? (
            <select name="status" defaultValue={status} className="pc-control" aria-label="Status">
              {STATUS_FILTERS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          ) : null}
          <select name="org" defaultValue={query.org ?? ""} className="pc-control" aria-label="Organization">
            <option value="">Any organization</option>
            {orgs.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <select name="brand" defaultValue={query.brand ?? ""} className="pc-control" aria-label="Brand">
            <option value="">Any brand</option>
            {brands.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <select name="kind" defaultValue={query.kind ?? ""} className="pc-control" aria-label="Entity type">
            <option value="">Publications and editors</option>
            <option value="publication">Publications</option>
            <option value="editor">Editors</option>
          </select>
          {view === "conflicts" ? (
            <select name="layer" defaultValue={query.layer ?? ""} className="pc-control" aria-label="Found by">
              <option value="">Rules and AI</option>
              <option value="rule">Rules</option>
              <option value="ai">AI</option>
            </select>
          ) : null}
        </div>
        {query.q || query.org || query.brand || query.kind || query.layer ? (
          <Link href={view === "entities" ? "/brain/conflicts?view=entities" : "/brain/conflicts"} className="inline-flex min-h-9 items-center text-sm font-semibold text-accent">
            Clear filters
          </Link>
        ) : null}
      </form>

      <nav className="mt-5 flex gap-1 border-b border-line" aria-label="Conflict views">
        {(
          [
            ["conflicts", "Conflicts"],
            ["entities", "Publications and editors"],
          ] as const
        ).map(([key, label]) => (
          <Link
            key={key}
            href={hrefWith(query, { view: key === "entities" ? "entities" : undefined })}
            className={`-mb-px inline-flex min-h-10 items-center border-b-2 px-3 text-sm font-semibold ${view === key ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"}`}
          >
            {label}
          </Link>
        ))}
      </nav>

      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <section className="min-w-0">
          {view === "conflicts" ? (
            rows.length === 0 ? (
              <p className="rounded-xl border border-line bg-white px-4 py-6 text-sm text-muted">
                {total === 0 && counts.checks === 0 ? "Nothing checked yet. Re-check everything to compare Publication Setup with the main Brain." : "No conflicts match these filters."}
              </p>
            ) : (
              <ul className="space-y-3">
                {rows.map((row) => (
                  <ConflictCard key={row.id} row={row} names={names} />
                ))}
              </ul>
            )
          ) : checks.length === 0 ? (
            <p className="rounded-xl border border-line bg-white px-4 py-6 text-sm text-muted">No publications or editors checked yet.</p>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
              {checks.map((check) => (
                <li key={check.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <Link href={`/brain/conflicts/entity/${check.entityKind}/${check.entityId}`} className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="break-words text-sm font-semibold text-ink">
                        {check.entityName}
                        {check.entityCode ? ` (${check.entityCode})` : ""}
                      </span>
                      <Badge tone="neutral">{kindLabel(check.entityKind)}</Badge>
                      {check.open ? <Badge tone="danger">{check.open} open</Badge> : <Badge tone="ok">No open conflicts</Badge>}
                      {check.status === "queued" || check.status === "running" ? <Badge tone="accent">Checking</Badge> : null}
                      {check.status === "failed" ? <Badge tone="warn">Check failed</Badge> : null}
                    </span>
                    <span className="mt-0.5 block break-words text-xs text-muted">
                      {[placeText(names, check.entityOrganizationId, check.entityBrandId), `${check.noteIds.length} matching note${check.noteIds.length === 1 ? "" : "s"}`, check.checkedAt ? `checked ${check.checkedAt.toISOString().slice(0, 10)}` : "not checked yet"].join(" · ")}
                    </span>
                  </Link>
                  <form action={recheckEntity}>
                    <input type="hidden" name="kind" value={check.entityKind} />
                    <input type="hidden" name="entityId" value={check.entityId} />
                    <input type="hidden" name="back" value="/brain/conflicts?view=entities" />
                    <button type="submit" className="min-h-9 rounded-md border border-line px-3 text-sm font-semibold hover:bg-canvas">
                      Re-check
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
        <aside className="min-w-0">
          <section className="rounded-xl border border-line bg-white p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">By organization and brand</h2>
            {places.length === 0 ? <p className="mt-2 text-sm text-muted">No conflicts recorded.</p> : null}
            <ul className="mt-2 space-y-1.5">
              {places.map((p) => (
                <li key={`${p.organizationId}:${p.brandId}`}>
                  <Link href={hrefWith(query, { org: p.organizationId, brand: p.brandId })} className="flex items-center justify-between gap-2 text-sm hover:text-accent">
                    <span className="min-w-0 break-words">{p.label}</span>
                    <span className="shrink-0 tabular-nums text-xs text-muted">
                      {p.OPEN} open · {p.RESOLVED + p.DISMISSED} closed
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
