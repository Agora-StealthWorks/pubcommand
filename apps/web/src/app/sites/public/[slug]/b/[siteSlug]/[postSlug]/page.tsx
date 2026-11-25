import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { tenantDb } from "@pubcommand/db";
import { siteBranding } from "@/features/miniblog/data";
import { loadPublicSite, publicBase, publicSiteMatches } from "@/features/miniblog/public";
import { trackedHrefs } from "@/features/miniblog/links";
import { BlogShell, PostBody, SubscribeCard, TopAd } from "@/features/miniblog/view";
import { formatZonedDate } from "../../../../../../../../../../modules/miniblog/time";

type Params = Promise<{ slug: string; siteSlug: string; postSlug: string }>;
type Search = Promise<{ preview?: string }>;

async function load(params: Params, searchParams: Search) {
  const { slug, siteSlug, postSlug } = await params;
  if (!(await publicSiteMatches(slug)) || !/^[a-z0-9-]{1,80}$/.test(postSlug)) return null;
  const loaded = await loadPublicSite(slug, siteSlug, await searchParams);
  if (!loaded) return null;
  const post = await tenantDb(loaded.organizationId).textPost.findFirst({
    where: { siteId: loaded.site.id, slug: postSlug, deletedAt: null, ...(loaded.preview ? {} : { status: "published", publishAt: { lte: loaded.now } }) },
  });
  return post ? { loaded, post, siteSlug } : null;
}

export async function generateMetadata({ params, searchParams }: { params: Params; searchParams: Search }): Promise<Metadata> {
  const result = await load(params, searchParams);
  if (!result) return { title: { absolute: "Not found" } };
  return { title: { absolute: `${result.post.title} · ${result.loaded.site.name}` }, robots: result.loaded.preview ? { index: false, follow: false } : undefined };
}

/** One Mini-Blog post: /b/<site>/<post> (also /t/…). Scheduled posts 404 until their publish time. */
export default async function MiniBlogPostPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const result = await load(params, searchParams);
  if (!result) notFound();
  const { loaded, post, siteSlug } = result;
  const { site, timeZone } = loaded;
  const base = await publicBase(siteSlug);
  const branding = siteBranding(site, loaded.brandName, base);
  const db = tenantDb(loaded.organizationId);
  const [hrefs, others] = await Promise.all([
    trackedHrefs(loaded.organizationId, [post.id], base, loaded.preview).then((map) => map.get(post.id)),
    branding.theme.footer === "tletter" && site.archivesEnabled
      ? db.textPost.findMany({ where: { siteId: site.id, deletedAt: null, status: "published", publishAt: { lte: loaded.now }, id: { not: post.id } }, orderBy: { publishAt: "desc" }, take: 60, select: { slug: true, title: true, publishAt: true } })
      : Promise.resolve([]),
  ]);
  const archives = others.map((item) => ({ href: `${base}/${item.slug}`, title: item.title, date: formatZonedDate(item.publishAt, timeZone) }));
  return (
    <BlogShell site={site} branding={branding} base={base} preview={loaded.preview} archives={archives} pixel={`${base}/px?p=${post.id}`}>
      {loaded.preview && post.status !== "published" ? <p className="text-xs font-semibold text-[#b54708]">Draft preview.</p> : null}
      <TopAd post={post} site={site} hrefs={hrefs} />
      <PostBody post={post} site={site} branding={branding} timeZone={timeZone} hrefs={hrefs} />
      <SubscribeCard site={site} base={base} />
      <p style={{ textAlign: "center", fontSize: 14 }}>
        <a href={base || "/"} style={{ fontWeight: 600, textDecoration: "underline", color: "var(--mb-page-muted)" }}>
          ← All posts
        </a>
      </p>
    </BlogShell>
  );
}
