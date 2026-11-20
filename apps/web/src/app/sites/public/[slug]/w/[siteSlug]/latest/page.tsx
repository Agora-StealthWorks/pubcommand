import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Archive, pageNumber } from "@/features/websites/archive";
import { loadSite, loadViewer } from "@/features/websites/public";

type Params = Promise<{ slug: string; siteSlug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, siteSlug } = await params;
  const loaded = await loadSite(slug, siteSlug);
  return { title: { absolute: loaded ? `Latest | ${loaded.site.name}` : "Not found" } };
}

export default async function LatestPage({ params, searchParams }: { params: Params; searchParams: Promise<{ page?: string }> }) {
  const { slug, siteSlug } = await params;
  const loaded = await loadSite(slug, siteSlug);
  if (!loaded) notFound();
  const { member } = await loadViewer(loaded.organizationId, loaded.site.id);
  return <Archive loaded={loaded} member={member} where={{}} title="Latest articles" kicker={loaded.site.name} page={pageNumber((await searchParams).page)} path={`${loaded.base}/latest`} active="/latest" />;
}
