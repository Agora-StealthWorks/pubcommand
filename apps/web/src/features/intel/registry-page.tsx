import { Badge, Button, Input, Label } from "@pubcommand/ui";
import Link from "next/link";
import { Denied, Flash } from "@/components/ui";
import { TableScroll } from "@/components/table-scroll";
import { ENTITY_KINDS, ENTITY_LABELS, LIST_CATEGORIES, LIST_CATEGORY_LABELS, type EntityKind, type ListCategory } from "../../../../../modules/intel/index";
import { intelAccess } from "./context";
import { competitorOptions } from "./data";
import { createEntity, rebuildLinks, toggleEntityIgnored } from "./more-actions";
import { listEntities, readRegistryFilters, registryCounts } from "./registry";

const HELP: Record<EntityKind, string> = {
  expert: "The named people competitors lean on: editors, analysts, doctors, coaches, spokespeople. Filled from the AI extraction.",
  list: "Each sender list or newsletter, matched by sender address first, then by the sender's name. Add addresses as aliases to fold re-branded senders together.",
  topic: "What the sends are about, from the AI extraction. Merge near-duplicates so counts add up.",
};

export function RegistryTabs({ kind, counts }: { kind: EntityKind; counts: Record<EntityKind, number> }) {
  return (
    <nav className="mb-4 flex max-w-full flex-wrap gap-1" aria-label="Registry">
      {ENTITY_KINDS.map((item) => (
        <Link
          key={item}
          href={ENTITY_LABELS[item].route}
          className={`inline-flex min-h-9 items-center gap-1 rounded-full border px-3 text-sm font-semibold ${item === kind ? "border-accent bg-accent text-white" : "border-line bg-white text-ink hover:bg-canvas"}`}
        >
          {ENTITY_LABELS[item].many}
          <span className={item === kind ? "text-white/80" : "text-muted"}>{counts[item]}</span>
        </Link>
      ))}
    </nav>
  );
}

export async function RegistryPage({ slug, kind, search }: { slug: string; kind: EntityKind; search: Record<string, string | undefined> }) {
  const access = await intelAccess("read", slug);
  if (!access.ok) return <Denied title={access.error} />;
  const { scope } = access;
  const filters = readRegistryFilters(search);
  const [rows, counts, competitors] = await Promise.all([
    listEntities(scope.organizationId, scope.brand.id, kind, filters),
    registryCounts(scope.organizationId, scope.brand.id),
    competitorOptions(scope.organizationId, scope.brand.id),
  ]);
  const competitorName = new Map(competitors.map((competitor) => [competitor.id, competitor.name]));
  const label = ENTITY_LABELS[kind];
  const route = label.route;
  const back = `${route}${Object.keys(search).some((key) => ["q", "competitor", "category", "show", "sort"].includes(key)) ? `?${new URLSearchParams(Object.entries(filters).filter(([, value]) => value) as [string, string][]).toString()}` : ""}`;
  const filtered = Boolean(filters.q || filters.competitor || filters.category || filters.show !== "active");

  return (
    <div className="min-w-0">
      <Flash error={search.error} notice={search.notice} />
      <RegistryTabs kind={kind} counts={counts} />
      <p className="mb-4 max-w-3xl text-sm text-muted">{HELP[kind]} Ignored entries stay linked (so they are not re-created) but are hidden from filters and counts.</p>

      <form action={route} className="mb-4 grid gap-3 rounded-xl border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))_auto]">
        <div className="min-w-0">
          <Label htmlFor="registry-q">Search</Label>
          <Input id="registry-q" name="q" defaultValue={filters.q} placeholder={`${label.one} name`} className="mt-1" />
        </div>
        {kind !== "topic" ? (
          <div className="min-w-0">
            <Label htmlFor="registry-competitor">Competitor</Label>
            <select id="registry-competitor" name="competitor" defaultValue={filters.competitor} className="pc-control mt-1 w-full">
              <option value="">All</option>
              {competitors.map((competitor) => (
                <option key={competitor.id} value={competitor.id}>
                  {competitor.name}
                </option>
              ))}
              <option value="none">None set</option>
            </select>
          </div>
        ) : null}
        {kind === "list" ? (
          <div className="min-w-0">
            <Label htmlFor="registry-category">Category</Label>
            <select id="registry-category" name="category" defaultValue={filters.category} className="pc-control mt-1 w-full">
              <option value="">All</option>
              {LIST_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {LIST_CATEGORY_LABELS[category]}
                </option>
              ))}
              <option value="none">Not set</option>
            </select>
          </div>
        ) : null}
        <div className="min-w-0">
          <Label htmlFor="registry-show">Show</Label>
          <select id="registry-show" name="show" defaultValue={filters.show} className="pc-control mt-1 w-full">
            <option value="active">Active</option>
            <option value="ignored">Ignored</option>
            <option value="all">All</option>
          </select>
        </div>
        <div className="min-w-0">
          <Label htmlFor="registry-sort">Sort</Label>
          <select id="registry-sort" name="sort" defaultValue={filters.sort} className="pc-control mt-1 w-full">
            <option value="count">Most used</option>
            <option value="name">Name</option>
          </select>
        </div>
        <div className="flex items-end gap-2">
          <Button type="submit" variant="secondary" className="w-full sm:w-auto">
            Filter
          </Button>
          {filtered ? (
            <Link href={route} className="inline-flex min-h-10 items-center px-2 text-sm text-muted underline">
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="min-w-0">
          <p className="mb-2 text-sm text-muted">
            {rows.length} {rows.length === 1 ? label.one.toLowerCase() : label.many.toLowerCase()}
            {rows.length === 2000 ? " (first 2,000)" : ""}
          </p>
          {rows.length === 0 ? (
            <div className="rounded-xl border border-line bg-white p-6 text-sm text-muted">
              {filtered ? "Nothing matches these filters." : `No ${label.many.toLowerCase()} yet. They are filled in as emails are added${kind === "list" ? "" : " and extracted"}.`}
            </div>
          ) : (
            <TableScroll>
              <table className="w-full min-w-[560px] border-separate border-spacing-0 overflow-hidden rounded-xl border border-line bg-white text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted">
                    <th className="border-b border-line px-3 py-2 font-semibold">{label.one}</th>
                    {kind !== "topic" ? <th className="border-b border-line px-3 py-2 font-semibold">Competitor</th> : null}
                    {kind === "list" ? <th className="border-b border-line px-3 py-2 font-semibold">Category</th> : null}
                    <th className="border-b border-line px-3 py-2 text-right font-semibold">Emails &amp; videos</th>
                    {scope.canWrite ? <th className="border-b border-line px-3 py-2" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="align-top">
                      <td className="border-b border-line px-3 py-2">
                        <Link href={`/ispy/registry/${row.id}`} className="pc-break font-semibold text-accent underline">
                          {row.name}
                        </Link>
                        {row.ignored ? (
                          <Badge className="ml-1">ignored</Badge>
                        ) : null}
                        {row.aliases.length ? <p className="pc-break text-xs text-muted">also: {row.aliases.slice(0, 4).join(", ")}{row.aliases.length > 4 ? ` +${row.aliases.length - 4}` : ""}</p> : null}
                      </td>
                      {kind !== "topic" ? <td className="border-b border-line px-3 py-2 text-ink">{row.competitorId ? competitorName.get(row.competitorId) ?? "" : <span className="text-muted">—</span>}</td> : null}
                      {kind === "list" ? <td className="border-b border-line px-3 py-2">{row.category ? LIST_CATEGORY_LABELS[row.category as ListCategory] : <span className="text-muted">—</span>}</td> : null}
                      <td className="border-b border-line px-3 py-2 text-right tabular-nums">
                        <Link href={`/ispy?${kind}=${row.id}`} className="underline">
                          {row.count}
                        </Link>
                      </td>
                      {scope.canWrite ? (
                        <td className="border-b border-line px-3 py-2 text-right">
                          <form action={toggleEntityIgnored}>
                            <input type="hidden" name="entityId" value={row.id} />
                            <input type="hidden" name="back" value={back} />
                            <Button type="submit" variant="secondary" size="sm">
                              {row.ignored ? "Restore" : "Ignore"}
                            </Button>
                          </form>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </section>

        {scope.canWrite ? (
          <aside className="min-w-0 space-y-4">
            <form action={createEntity} className="space-y-2 rounded-xl border border-line bg-white p-4">
              <input type="hidden" name="kind" value={kind} />
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Add {label.one.toLowerCase()}</h3>
              <div>
                <Label htmlFor="new-entity-name">Name</Label>
                <Input id="new-entity-name" name="name" required className="mt-1" />
              </div>
              <div>
                <Label htmlFor="new-entity-aliases">{kind === "list" ? "Aliases and sender addresses" : "Aliases"}</Label>
                <Input id="new-entity-aliases" name="aliases" placeholder="Comma separated" className="mt-1" />
              </div>
              {kind === "list" ? (
                <div>
                  <Label htmlFor="new-entity-category">Category</Label>
                  <select id="new-entity-category" name="category" className="pc-control mt-1 w-full" defaultValue="">
                    <option value="">Not set</option>
                    {LIST_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {LIST_CATEGORY_LABELS[category]}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <Button type="submit" size="sm">
                Add
              </Button>
            </form>
            <form action={rebuildLinks} className="space-y-2 rounded-xl border border-line bg-white p-4">
              <input type="hidden" name="kind" value={kind} />
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Rebuild links</h3>
              <p className="text-sm text-muted">Re-link recent emails and videos to experts, lists and topics after adding aliases. New mail is linked automatically.</p>
              <Button type="submit" variant="secondary" size="sm">
                Rebuild links
              </Button>
            </form>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
