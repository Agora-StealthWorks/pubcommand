import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { tenantDb } from "@pubcommand/db";
import { siteBranding } from "@/features/funnels/data";
import { loadPublicSite, publicBase, publicSiteMatches, recordSiteView } from "@/features/funnels/public";
import { PostBody, SubscribeCard, TextShell } from "@/features/funnels/text-view";

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

/** One text-letter post: /t/<site>/<post>. Scheduled posts 404 until their publish time. */
export default async function TextPostPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const result = await load(params, searchParams);
  if (!result) notFound();
  const { loaded, post, siteSlug } = result;
  const base = await publicBase("t", siteSlug);
  const branding = siteBranding(loaded.site, loaded.brandName, base);
  await recordSiteView(loaded, post.id);
  return (
    <TextShell site={loaded.site} branding={branding} base={base} preview={loaded.preview}>
      <div className="space-y-5">
        {loaded.preview && post.status !== "published" ? <p className="text-xs font-semibold text-[#b54708]">Draft preview.</p> : null}
        <PostBody post={post} branding={branding} timeZone={loaded.timeZone} />
        <SubscribeCard site={loaded.site} branding={branding} base={base} />
        <p className="text-center text-sm">
          <a href={base || "/"} className="font-semibold underline">
            ← All posts
          </a>
        </p>
      </div>
    </TextShell>
  );
}
