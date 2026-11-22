import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadSite, loadViewer } from "@/features/websites/public";
import { PublicationsList } from "@/features/websites/publications-view";

type Params = Promise<{ slug: string; siteSlug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, siteSlug } = await params;
  const loaded = await loadSite(slug, siteSlug);
  return { title: { absolute: loaded ? `Free newsletters | ${loaded.site.name}` : "Not found" } };
}

/** Free newsletters, grouped by category. */
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
      pubs={loaded.free}
      active="/newsletters"
      kicker="Free, by email"
      title="Our free newsletters"
      intro={`Free newsletters from ${loaded.site.name}, by category. Open any one to sign up.`}
      signup={query.signup}
    />
  );
}
