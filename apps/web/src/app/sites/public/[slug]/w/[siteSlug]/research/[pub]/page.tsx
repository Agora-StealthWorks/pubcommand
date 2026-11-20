import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pageNumber } from "@/features/websites/archive";
import { PublicationLanding } from "@/features/websites/landing";
import { loadSite, loadViewer, pubBySlug } from "@/features/websites/public";

type Params = Promise<{ slug: string; siteSlug: string; pub: string }>;

async function find(slug: string, siteSlug: string, pubSlug: string) {
  const loaded = await loadSite(slug, siteSlug);
  const pub = loaded ? pubBySlug(loaded, pubSlug) : undefined;
  if (!loaded || !pub || loaded.free.includes(pub)) return null;
  return { loaded, pub };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, siteSlug, pub } = await params;
  const found = await find(slug, siteSlug, pub);
  return found ? { title: { absolute: `${found.pub.name} | ${found.loaded.site.name}` }, description: found.pub.description || found.pub.tagline || undefined } : { title: { absolute: "Not found" } };
}

export default async function PublicationPage({ params, searchParams }: { params: Params; searchParams: Promise<{ page?: string; signup?: string }> }) {
  const { slug, siteSlug, pub } = await params;
  const query = await searchParams;
  const found = await find(slug, siteSlug, pub);
  if (!found) notFound();
  const { member } = await loadViewer(found.loaded.organizationId, found.loaded.site.id);
  return <PublicationLanding loaded={found.loaded} member={member} pub={found.pub} page={pageNumber(query.page)} signup={query.signup} kind="research" />;
}
