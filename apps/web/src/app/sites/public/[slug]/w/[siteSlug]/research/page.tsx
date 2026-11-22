import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadSite, loadViewer } from "@/features/websites/public";
import { PublicationsList } from "@/features/websites/publications-view";

type Params = Promise<{ slug: string; siteSlug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, siteSlug } = await params;
  const loaded = await loadSite(slug, siteSlug);
  return { title: { absolute: loaded ? `Our research | ${loaded.site.name}` : "Not found" } };
}

/** Paid publications, grouped by category. */
export default async function ListPage({ params, searchParams }: { params: Params; searchParams: Promise<{ signup?: string }> }) {
  const { slug, siteSlug } = await params;
  const query = await searchParams;
  const loaded = await loadSite(slug, siteSlug);
  if (!loaded) notFound();
  const { member } = await loadViewer(loaded.organizationId, loaded.site.id);
  return (
    <PublicationsList
      loaded={loaded}
      member={member}
      pubs={loaded.paid}
      active="/research"
      kicker="Premium research"
      title="Our research services"
      intro={`Paid publications from ${loaded.site.name}, by category. Open any one to see what you get, who writes it and how to join.`}
      signup={query.signup}
    />
  );
}
