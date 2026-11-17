import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied } from "@/components/ui";
import { wikiLists } from "@/features/wiki/data";
import { wikiPage } from "@/features/wiki/guard";
import { Avatar, SearchBox } from "@/features/wiki/ui";
import { filterEditors } from "../../../../../../../../../modules/wiki/wiki";

export default async function WikiEditorsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ q?: string; show?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await wikiPage(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx, can } = access;
  const q = query.q ?? "";
  const showInactive = query.show === "all";
  const { editors } = await wikiLists(ctx.resolved.id, ctx.brand.id);
  const inactive = editors.filter((e) => e.status !== "active").length;
  const shown = filterEditors(showInactive ? editors : editors.filter((e) => e.status === "active"), q);

  return (
    <div className="space-y-4">
      <SearchBox action="/wiki/editors" q={q} placeholder="Search by name, specialty or publication…">
        {showInactive ? <input type="hidden" name="show" value="all" /> : null}
      </SearchBox>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        {inactive ? (
          <Link href={`/wiki/editors?${new URLSearchParams({ ...(q ? { q } : {}), ...(showInactive ? {} : { show: "all" }) }).toString()}`} className="inline-flex min-h-11 items-center text-accent hover:underline">
            {showInactive ? "Hide inactive editors" : `Show ${inactive} inactive`}
          </Link>
        ) : (
          <span />
        )}
        {can.editSetup ? (
          <Link href="/publication-setup/editors" className="inline-flex min-h-11 items-center text-accent hover:underline">
            Edit in Publication Setup
          </Link>
        ) : null}
      </div>
      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-white p-6 text-center text-sm text-muted">{q ? "No editor matches that search." : "No editors yet."}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((e) => (
            <li key={e.id} className="min-w-0">
              <Link href={`/wiki/editors/${e.slug}`} className="flex h-full min-w-0 gap-3 rounded-xl border border-line bg-white p-4 hover:border-accent">
                <Avatar editor={e} />
                <span className="min-w-0 flex-1 space-y-1">
                  <span className="block font-semibold [overflow-wrap:anywhere]">
                    {e.name}
                    {e.status !== "active" ? <span className="ml-2 text-xs font-normal text-muted">Inactive</span> : null}
                  </span>
                  {e.title ? <span className="block text-sm text-muted [overflow-wrap:anywhere]">{e.title}</span> : null}
                  {e.shortBio ? <span className="line-clamp-2 block text-sm">{e.shortBio}</span> : null}
                  {e.publications.length ? <span className="block text-xs text-muted [overflow-wrap:anywhere]">{e.publications.map((p) => p.name).join(", ")}</span> : null}
                  {e.specialties.length ? (
                    <span className="flex flex-wrap gap-1 pt-1">
                      {e.specialties.slice(0, 4).map((s) => (
                        <span key={s} className="rounded-full bg-canvas px-2 py-0.5 text-xs text-muted">
                          {s}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
