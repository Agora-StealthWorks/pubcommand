import { tenantDb } from "@pubcommand/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { SiteBar } from "@/features/websites/admin-ui";
import { PostEditor } from "@/features/websites/editor";
import { UUID_RE, websitesAccess } from "@/features/websites/guard";

export default async function EditPostPage({ params, searchParams }: { params: Promise<{ slug: string; postId: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug, postId } = await params;
  const query = await searchParams;
  const access = await websitesAccess(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx, sites, canPublish, canWrite } = access;
  if (!UUID_RE.test(postId)) notFound();
  const post = await tenantDb(ctx.resolved.id).webPost.findFirst({ where: { id: postId } });
  const site = post ? sites.find((item) => item.id === post.siteId) : undefined;
  if (!post || !site) notFound();
  const list = post.kind === "page" ? "/websites/pages" : "/websites/posts";
  return (
    <div>
      <div className="flex flex-wrap items-start gap-3">
        <PageHeader title={post.kind === "page" ? "Edit page" : "Edit post"} />
        <Link href={list} className="mt-1 text-sm font-semibold text-accent">
          ← All {post.kind === "page" ? "pages" : "posts"}
        </Link>
      </div>
      <Flash error={query.error} notice={query.notice} />
      {post.deletedAt ? <p className="mb-4 rounded-md border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm text-[#912018]">This is in the trash. Restore it from the list to publish it again.</p> : null}
      <SiteBar sites={sites} site={site} back={list} />
      <PostEditor organizationId={ctx.resolved.id} brandId={ctx.brand.id} site={site} post={post} kind={post.kind === "page" ? "page" : "post"} canPublish={canPublish} canWrite={canWrite} />
    </div>
  );
}
