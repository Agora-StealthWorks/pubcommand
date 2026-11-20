import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { tenantDb } from "@pubcommand/db";
import { Archive, pageNumber } from "@/features/websites/archive";
import { loadSite, loadViewer } from "@/features/websites/public";

type Params = Promise<{ slug: string; siteSlug: string; term: string }>;

async function find(slug: string, siteSlug: string, term: string) {
  const loaded = await loadSite(slug, siteSlug);
  if (!loaded || !/^[a-z0-9-]{1,80}$/.test(term)) return null;
  const row = await tenantDb(loaded.organizationId).webTerm.findFirst({ where: { siteId: loaded.site.id, kind: "category", slug: term } });
  return row ? { loaded, row } : null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, siteSlug, term } = await params;
  const found = await find(slug, siteSlug, term);
  return { title: { absolute: found ? `${found.row.name} | ${found.loaded.site.name}` : "Not found" }, description: found?.row.description || undefined };
}

export default async function TermPage({ params, searchParams }: { params: Params; searchParams: Promise<{ page?: string }> }) {
  const { slug, siteSlug, term } = await params;
  const found = await find(slug, siteSlug, term);
  if (!found) notFound();
  const { loaded, row } = found;
  const { member } = await loadViewer(loaded.organizationId, loaded.site.id);
  return (
    <Archive
      loaded={loaded}
      member={member}
      where={{ terms: { some: { termId: row.id } } }}
      title={`${row.name}`}
      kicker="Category"
      intro={row.description || undefined}
      page={pageNumber((await searchParams).page)}
      path={`${loaded.base}/category/${row.slug}`}
      active={`/category/${row.slug}`}
    />
  );
}
