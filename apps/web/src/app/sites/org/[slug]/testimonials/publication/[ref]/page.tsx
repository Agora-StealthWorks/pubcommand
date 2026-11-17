import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied } from "@/components/ui";
import { getPublication } from "@/features/pubsetup/read";
import { testimonialsPage } from "@/features/testimonials/guard";
import { PAGE_SIZE, listTestimonials } from "@/features/testimonials/server";
import { tenantDb } from "@pubcommand/db";
import { FilterBar, Pager, StatusTabs, TestimonialTable } from "@/features/testimonials/ui";
import { parseFilters } from "../../../../../../../../../../modules/testimonials/testimonials";

/** One publication's testimonials (the per-publication view the wiki links to). */
export default async function PublicationTestimonialsPage({ params, searchParams }: { params: Promise<{ slug: string; ref: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug, ref } = await params;
  const query = await searchParams;
  const access = await testimonialsPage(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx, can } = access;
  const pub = await getPublication(ctx.resolved.id, ctx.brand.id, decodeURIComponent(ref));
  if (!pub) notFound();
  const filters = { ...parseFilters(query), pub: pub.id };
  const base = `/testimonials/publication/${pub.slug}`;
  const db = tenantDb(ctx.resolved.id);
  const [{ rows, total, look }, ...counts] = await Promise.all([
    listTestimonials(ctx.resolved.id, ctx.brand.id, filters),
    ...(["pending", "approved", "rejected"] as const).map((status) => db.testimonial.count({ where: { brandId: ctx.brand.id, publicationId: pub.id, deletedAt: null, status } })),
  ]);
  const [pending, approved, rejected] = counts as number[];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white p-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="h-10 w-2 shrink-0 rounded-full" style={{ background: pub.color }} aria-hidden />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold [overflow-wrap:anywhere]">{pub.name}</h2>
            <p className="text-xs text-muted">
              {pub.code} · {approved} approved · {pending} pending · {rejected} rejected
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          {can.wiki ? (
            <Link href={`/wiki/publications/${pub.slug}`} className="inline-flex min-h-11 items-center text-accent hover:underline">
              Wiki page
            </Link>
          ) : null}
          {can.write ? (
            <Link href={`/testimonials/new?pub=${pub.id}`} className="inline-flex min-h-11 items-center rounded-md bg-accent px-3.5 font-semibold text-white">
              + Add
            </Link>
          ) : null}
        </div>
      </div>
      <StatusTabs filters={filters} counts={{ pending: pending!, approved: approved!, rejected: rejected!, all: pending! + approved! + rejected! }} base={base} />
      <FilterBar
        filters={filters}
        lockedPub
        base={base}
        options={{ publications: [], editors: look.editorList.filter((e) => !e.archived).map((e) => ({ id: e.id, name: e.name })) }}
      />
      <TestimonialTable rows={rows} wikiLinks={can.wiki} />
      <Pager filters={filters} total={total} pageSize={PAGE_SIZE} base={base} />
    </div>
  );
}
