import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { deleteViewAction, saveViewAction } from "@/features/testimonials/actions";
import { testimonialsPage } from "@/features/testimonials/guard";
import { PAGE_SIZE, listTestimonials, listViews, statusCounts } from "@/features/testimonials/server";
import { FilterBar, Pager, StatusTabs, TestimonialTable } from "@/features/testimonials/ui";
import { filtersToQuery, parseFilters } from "../../../../../../../../modules/testimonials/testimonials";

export default async function TestimonialsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await testimonialsPage(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx, can } = access;
  const filters = parseFilters(query);
  const [{ rows, total, look }, counts, views] = await Promise.all([
    listTestimonials(ctx.resolved.id, ctx.brand.id, filters),
    statusCounts(ctx.resolved.id, ctx.brand.id),
    listViews(ctx.resolved.id, ctx.brand.id),
  ]);
  const current = filtersToQuery({ ...filters, page: 1 });
  const options = {
    publications: look.publications.filter((p) => !p.archived).map((p) => ({ id: p.id, name: p.name, code: p.code })),
    editors: look.editorList.filter((e) => !e.archived).map((e) => ({ id: e.id, name: e.name })),
  };
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  return (
    <div className="space-y-4">
      <Flash error={one(query.error)} notice={one(query.notice)} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusTabs filters={filters} counts={counts} base="/testimonials" />
        <div className="flex flex-wrap gap-2">
          <a href={`/testimonials/export${current ? `?${current}` : ""}`} className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3 text-sm font-medium">
            Export CSV
          </a>
          {can.write ? (
            <Link href="/testimonials/new" className="inline-flex min-h-11 items-center rounded-md bg-accent px-3.5 text-sm font-semibold text-white">
              + Add testimonial
            </Link>
          ) : null}
        </div>
      </div>

      {views.length || can.write ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">Saved views</span>
          {views.map((v) => (
            <span key={v.id} className={`inline-flex items-center rounded-full border ${v.query === current ? "border-accent bg-[#dbe7ff]" : "border-line bg-white"}`}>
              <Link href={`/testimonials${v.query ? `?${v.query}` : ""}`} className="inline-flex min-h-9 items-center px-3">
                {v.name}
              </Link>
              {can.write ? (
                <form action={deleteViewAction}>
                  <input type="hidden" name="viewId" value={v.id} />
                  <button type="submit" className="inline-flex min-h-9 items-center pr-3 text-muted hover:text-ink" aria-label={`Remove view ${v.name}`}>
                    ×
                  </button>
                </form>
              ) : null}
            </span>
          ))}
          {can.write && current ? (
            <form action={saveViewAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="query" value={current} />
              <input name="name" required maxLength={80} placeholder="Name this view" aria-label="View name" className="pc-control w-44" />
              <button type="submit" className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3 font-medium">
                Save view
              </button>
            </form>
          ) : null}
          {!views.length && !current ? <span className="text-xs text-muted">Filter the table, then save it as a view for the team.</span> : null}
        </div>
      ) : null}

      <FilterBar filters={filters} options={options} base="/testimonials" />
      <p className="text-sm text-muted">
        {total} testimonial{total === 1 ? "" : "s"}
      </p>
      <TestimonialTable rows={rows} wikiLinks={can.wiki} />
      <Pager filters={filters} total={total} pageSize={PAGE_SIZE} base="/testimonials" />
    </div>
  );
}
