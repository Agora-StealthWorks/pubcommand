import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied } from "@/components/ui";
import { StatusBadge } from "@/features/pubsetup/ui";
import { wikiLists } from "@/features/wiki/data";
import { wikiPage } from "@/features/wiki/guard";
import { PubLogo, SearchBox } from "@/features/wiki/ui";
import { EDITOR_ROLE_LABELS } from "../../../../../../../../../modules/pubsetup/fields";
import { asPubFilter, filterPublications, isCurrent, priceSummary, type PubFilter } from "../../../../../../../../../modules/wiki/wiki";
import { groupByFunnel } from "../../../../../../../../../modules/pubsetup/groups";

const TABS: [PubFilter, string][] = [
  ["active", "Active"],
  ["retired", "Retired"],
  ["all", "All"],
];

export default async function WikiPublicationsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ q?: string; status?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await wikiPage(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx, can } = access;
  const q = query.q ?? "";
  const status = asPubFilter(query.status);
  const { publications, counts } = await wikiLists(ctx.resolved.id, ctx.brand.id);
  const shown = filterPublications(publications, { q, status });
  const groups = groupByFunnel(shown);
  const tally = { active: publications.filter(isCurrent).length, retired: publications.filter((p) => p.status === "retired").length, all: publications.length };
  const href = (s: PubFilter) => `/wiki/publications?${new URLSearchParams({ ...(q ? { q } : {}), ...(s !== "active" ? { status: s } : {}) }).toString()}`;

  return (
    <div className="space-y-4">
      <SearchBox action="/wiki/publications" q={q} placeholder="Search by name, code, editor or type…">
        {status !== "active" ? <input type="hidden" name="status" value={status} /> : null}
      </SearchBox>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 text-sm" role="tablist" aria-label="Status">
          {TABS.map(([key, label]) => (
            <Link key={key} href={href(key)} role="tab" aria-selected={status === key} className={`inline-flex min-h-11 items-center rounded-md px-3 font-medium ${status === key ? "bg-white text-ink shadow-sm" : "text-muted hover:bg-white"}`}>
              {label} · {tally[key]}
            </Link>
          ))}
        </div>
        {can.editSetup ? (
          <Link href="/settings/publication-setup" className="inline-flex min-h-11 items-center text-sm text-accent hover:underline">
            Edit in Publication Setup
          </Link>
        ) : null}
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-white p-6 text-center text-sm text-muted">{q ? "No publication matches that search." : "No publications here."}</p>
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <section key={group.key} aria-labelledby={`wiki-group-${group.key}`} className="space-y-2">
              <h2 id={`wiki-group-${group.key}`} className="text-xs font-semibold uppercase tracking-wider text-muted">
                {group.label} · {group.items.length}
              </h2>
              <ul className="grid gap-3 md:grid-cols-2">
                {group.items.map((pub) => {
                  const price = pub.retailPrice ? (/\d/.test(pub.retailPrice) ? `${pub.retailPrice} retail` : pub.retailPrice) : priceSummary(pub.offers);
                  const n = counts.get(pub.id) ?? 0;
                  return (
                    <li key={pub.id} className="min-w-0">
                      <Link href={`/wiki/publications/${pub.slug}`} className="flex h-full min-w-0 gap-3 rounded-xl border border-line bg-white p-4 hover:border-accent">
                        <PubLogo pub={pub} />
                        <span className="min-w-0 flex-1 space-y-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold [overflow-wrap:anywhere]">{pub.name}</span>
                            <span className="rounded border border-line px-1.5 text-xs font-semibold text-muted">{pub.code}</span>
                            {pub.status !== "active" ? <StatusBadge status={pub.status} /> : null}
                          </span>
                          {pub.tagline || pub.description ? <span className="line-clamp-2 block text-sm text-muted">{pub.tagline || pub.description}</span> : null}
                          <span className="block text-xs text-muted [overflow-wrap:anywhere]">{[pub.pubType, pub.tier, pub.frequency].filter(Boolean).join(" · ")}</span>
                          {pub.editors.length ? (
                            <span className="block text-xs [overflow-wrap:anywhere]">
                              {pub.editors.map((e) => `${e.name}${e.role !== "lead" ? ` (${EDITOR_ROLE_LABELS[e.role] ?? e.role})` : ""}`).join(", ")}
                            </span>
                          ) : null}
                          {price || pub.positioning ? <span className="line-clamp-2 block text-xs text-muted">{[price, pub.positioning].filter(Boolean).join(" — ")}</span> : null}
                          {n ? <span className="block text-xs font-medium text-[#067647]">{n} approved testimonial{n === 1 ? "" : "s"}</span> : null}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
