import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied } from "@/components/ui";
import { wikiHome } from "@/features/wiki/data";
import { wikiPage } from "@/features/wiki/guard";
import { Avatar, PubLogo, SearchBox, Section, TestimonialGrid } from "@/features/wiki/ui";
import { filterPublications, wikiSearch } from "../../../../../../../../modules/wiki/wiki";

export default async function WikiHomePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ q?: string }> }) {
  const { slug } = await params;
  const { q = "" } = await searchParams;
  const access = await wikiPage(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx, can } = access;
  const data = await wikiHome(ctx.resolved.id, ctx.brand.id, { testimonials: true });
  const current = filterPublications(data.publications, { status: "active" });
  const found = wikiSearch(data.publications, data.editors, q);
  const pubMap = new Map(data.publications.map((p) => [p.id, { slug: p.slug, name: p.name }]));
  const editorMap = new Map(data.editors.map((e) => [e.id, { slug: e.slug, name: e.name }]));

  return (
    <div className="space-y-5">
      <SearchBox action="/wiki" q={q} placeholder="Search publications, editors, specialties…" />

      {q.trim() ? (
        <Section title={`Results for “${q.trim()}”`}>
          {found.publications.length + found.editors.length === 0 ? <p className="text-sm text-muted">Nothing matches. Try a publication code, an editor&apos;s name or a specialty.</p> : null}
          <ul className="divide-y divide-line">
            {found.publications.map((p) => (
              <li key={p.id}>
                <Link href={`/wiki/publications/${p.slug}`} className="flex min-h-11 items-center gap-3 py-2 hover:text-accent">
                  <PubLogo pub={p} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium [overflow-wrap:anywhere]">{p.name}</span>
                    <span className="block text-xs text-muted">Publication · {p.code}{p.status === "retired" ? " · Retired" : ""}</span>
                  </span>
                </Link>
              </li>
            ))}
            {found.editors.map((e) => (
              <li key={e.id}>
                <Link href={`/wiki/editors/${e.slug}`} className="flex min-h-11 items-center gap-3 py-2 hover:text-accent">
                  <Avatar editor={e} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium [overflow-wrap:anywhere]">{e.name}</span>
                    <span className="block text-xs text-muted [overflow-wrap:anywhere]">Editor{e.title ? ` · ${e.title}` : ""}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <div className="grid grid-cols-3 gap-3">
        {[
          ["/wiki/publications", current.length, "Publications"],
          ["/wiki/editors", data.editors.length, "Editors"],
          [can.testimonials ? "/testimonials?status=approved" : null, data.latest.total, "Approved testimonials"],
        ].map(([href, n, label]) => {
          const body = (
            <>
              <span className="block text-2xl font-semibold">{n}</span>
              <span className="block text-xs text-muted">{label}</span>
            </>
          );
          return href ? (
            <Link key={String(label)} href={String(href)} className="rounded-xl border border-line bg-white p-3 hover:border-accent sm:p-4">
              {body}
            </Link>
          ) : (
            <div key={String(label)} className="rounded-xl border border-line bg-white p-3 sm:p-4">
              {body}
            </div>
          );
        })}
      </div>

      <Section title="Publications" action={<Link href="/wiki/publications" className="text-sm text-accent hover:underline">All publications</Link>}>
        {current.length === 0 ? (
          <p className="text-sm text-muted">No publications yet.{can.editSetup ? " Add them in Publication Setup." : " An admin adds them in Publication Setup."}</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {current.slice(0, 9).map((p) => (
              <li key={p.id} className="min-w-0">
                <Link href={`/wiki/publications/${p.slug}`} className="flex min-h-11 items-center gap-3 rounded-lg border border-line p-2.5 hover:border-accent">
                  <PubLogo pub={p} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{p.name}</span>
                    <span className="block truncate text-xs text-muted">{p.tagline || p.pubType || p.code}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Editors" action={<Link href="/wiki/editors" className="text-sm text-accent hover:underline">All editors</Link>}>
        {data.editors.length === 0 ? (
          <p className="text-sm text-muted">No editors yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-3">
            {data.editors.slice(0, 12).map((e) => (
              <li key={e.id}>
                <Link href={`/wiki/editors/${e.slug}`} className="flex w-24 flex-col items-center gap-1.5 text-center text-xs hover:text-accent">
                  <Avatar editor={e} />
                  <span className="line-clamp-2 font-medium">{e.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {data.latest.items.length ? (
        <Section title="Latest approved testimonials" action={can.testimonials ? <Link href="/testimonials?status=approved" className="text-sm text-accent hover:underline">See all</Link> : null}>
          <TestimonialGrid items={data.latest.items} pubs={pubMap} editors={editorMap} canManage={can.testimonials} />
        </Section>
      ) : null}
    </div>
  );
}
