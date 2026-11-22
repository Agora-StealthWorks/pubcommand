import { notFound, redirect } from "next/navigation";
import { loadSite, pubBySlug } from "@/features/websites/public";
import { publicationHref } from "@/features/websites/publications-view";

/** /publications/<pub> is a short link: the page lives under /newsletters (free) or /research (paid). */
export default async function PublicationShortLink({ params }: { params: Promise<{ slug: string; siteSlug: string; pub: string }> }) {
  const { slug, siteSlug, pub: pubSlug } = await params;
  const loaded = await loadSite(slug, siteSlug);
  const pub = loaded ? pubBySlug(loaded, pubSlug) : undefined;
  if (!loaded || !pub) notFound();
  redirect(publicationHref(loaded, pub));
}
