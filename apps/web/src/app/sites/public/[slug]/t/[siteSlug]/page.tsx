import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { postState, siteBranding } from "@/features/funnels/data";
import { loadPublicSite, publicBase, publicSiteMatches, recordSiteView } from "@/features/funnels/public";
import { PostBody, SubscribeCard, TextShell } from "@/features/funnels/text-view";
import { tenantDb } from "@pubcommand/db";
import { excerpt } from "../../../../../../../../../modules/funnels/stats";
import { formatZonedDate } from "../../../../../../../../../modules/funnels/time";

type Params = Promise<{ slug: string; siteSlug: string }>;
type Search = Promise<{ preview?: string }>;

export async function generateMetadata({ params, searchParams }: { params: Params; searchParams: Search }): Promise<Metadata> {
  const { slug, siteSlug } = await params;
  const loaded = (await publicSiteMatches(slug)) ? await loadPublicSite(slug, siteSlug, await searchParams) : null;
  if (!loaded) return { title: { absolute: "Not found" } };
  return { title: { absolute: loaded.site.name }, description: loaded.site.tagline || undefined, robots: loaded.preview ? { index: false, follow: false } : undefined };
}

/** Text-letter site home: the latest post, the archive and a subscribe button. */
export default async function TextSiteHome({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { slug, siteSlug } = await params;
  if (!(await publicSiteMatches(slug))) notFound();
  const loaded = await loadPublicSite(slug, siteSlug, await searchParams);
  if (!loaded) notFound();
  const { site, timeZone, now } = loaded;
  const base = await publicBase("t", siteSlug);
  const branding = siteBranding(site, loaded.brandName, base);
  const posts = await tenantDb(loaded.organizationId).textPost.findMany({
    where: { siteId: site.id, deletedAt: null, status: "published", ...(loaded.preview ? {} : { publishAt: { lte: now } }) },
    orderBy: { publishAt: "desc" },
    take: 60,
  });
  await recordSiteView(loaded, null);
  const [latest, ...older] = posts;
  return (
    <TextShell site={site} branding={branding} base={base} preview={loaded.preview}>
      <div className="space-y-5">
        {latest ? (
          <>
            {loaded.preview && postState(latest, now) === "scheduled" ? <p className="text-xs font-semibold text-[#b54708]">Scheduled: visitors see this from its publish time.</p> : null}
            <PostBody post={latest} branding={branding} timeZone={timeZone} />
          </>
        ) : (
          <div className="rounded-xl border border-black/10 bg-white p-6 text-center">
            <h1 className="text-xl font-bold">{site.name}</h1>
            <p className="mt-2 text-sm text-[#475467]">No posts yet. Subscribe to get the first one.</p>
          </div>
        )}
        <SubscribeCard site={site} branding={branding} base={base} />
        {site.archivesEnabled && older.length ? (
          <section className="rounded-xl border border-black/10 bg-white">
            <h2 className="border-b border-black/10 px-5 py-3 text-sm font-bold uppercase tracking-wider text-[#475467]">Archive</h2>
            <ul>
              {older.map((post) => (
                <li key={post.id} className="border-b border-black/5 last:border-0">
                  <a href={`${base}/${post.slug}`} className="block px-5 py-3 hover:bg-[#f9fafb]">
                    <span className="block text-xs text-[#475467]">{formatZonedDate(post.publishAt, timeZone)}</span>
                    <span className="block font-semibold [overflow-wrap:anywhere]">{post.title}</span>
                    <span className="block text-sm text-[#475467] [overflow-wrap:anywhere]">{excerpt(post.bodyHtml, 120)}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </TextShell>
  );
}
