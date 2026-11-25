import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { siteBranding } from "@/features/miniblog/data";
import { loadPublicSite, publicBase, publicSiteMatches } from "@/features/miniblog/public";
import { trackedHrefs } from "@/features/miniblog/links";
import { ArchiveCard, BlogShell, PostBody, SubscribeCard, TopAd } from "@/features/miniblog/view";
import { stripContentAd } from "../../../../../../../../../modules/miniblog/ads";
import { tenantDb } from "@pubcommand/db";
import { excerpt, postState } from "../../../../../../../../../modules/miniblog/site";
import { formatZonedDate } from "../../../../../../../../../modules/miniblog/time";

type Params = Promise<{ slug: string; siteSlug: string }>;
type Search = Promise<{ preview?: string }>;

export async function generateMetadata({ params, searchParams }: { params: Params; searchParams: Search }): Promise<Metadata> {
  const { slug, siteSlug } = await params;
  const loaded = (await publicSiteMatches(slug)) ? await loadPublicSite(slug, siteSlug, await searchParams) : null;
  if (!loaded) return { title: { absolute: "Not found" } };
  return { title: { absolute: loaded.site.name }, description: loaded.site.tagline || undefined, robots: loaded.preview ? { index: false, follow: false } : undefined };
}

/** Mini-Blog home (/b/<site>, also /t/<site>): the latest post, the archive and a subscribe button. */
export default async function MiniBlogHome({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { slug, siteSlug } = await params;
  if (!(await publicSiteMatches(slug))) notFound();
  const loaded = await loadPublicSite(slug, siteSlug, await searchParams);
  if (!loaded) notFound();
  const { site, timeZone, now } = loaded;
  const base = await publicBase(siteSlug);
  const branding = siteBranding(site, loaded.brandName, base);
  const posts = await tenantDb(loaded.organizationId).textPost.findMany({
    where: { siteId: site.id, deletedAt: null, status: "published", ...(loaded.preview ? {} : { publishAt: { lte: now } }) },
    orderBy: { publishAt: "desc" },
    take: 60,
  });
  const [latest, ...older] = posts;
  const hrefs = latest ? (await trackedHrefs(loaded.organizationId, [latest.id], base, loaded.preview)).get(latest.id) : undefined;
  const archives = older.map((post) => ({ href: `${base}/${post.slug}`, title: post.title, date: formatZonedDate(post.publishAt, timeZone), excerpt: excerpt(stripContentAd(post.bodyHtml), 120) }));
  const tletter = branding.theme.footer === "tletter";
  return (
    <BlogShell site={site} branding={branding} base={base} preview={loaded.preview} archives={archives} pixel={`${base}/px${latest ? `?p=${latest.id}` : ""}`}>
      {latest ? (
        <>
          {loaded.preview && postState(latest, now) === "scheduled" ? <p className="text-xs font-semibold text-[#b54708]">Scheduled: visitors see this from its publish time.</p> : null}
          <TopAd post={latest} site={site} hrefs={hrefs} />
          <PostBody post={latest} site={site} branding={branding} timeZone={timeZone} hrefs={hrefs} />
        </>
      ) : (
        <div className="mb-card" style={{ textAlign: "center" }}>
          <h1 className="mb-title">{site.name}</h1>
          <p className="mb-date">No posts yet.</p>
        </div>
      )}
      <SubscribeCard site={site} base={base} />
      {!tletter && site.archivesEnabled ? <ArchiveCard archives={archives} /> : null}
    </BlogShell>
  );
}
