import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { NoSite, SiteBar } from "@/features/websites/admin-ui";
import { websitesAccess } from "@/features/websites/guard";
import { PostList, type ListQuery } from "@/features/websites/post-list";

export default async function PostsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<ListQuery & { error?: string; notice?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await websitesAccess(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx, sites, site, canWrite } = access;
  return (
    <div>
      <div className="flex flex-wrap items-start gap-3">
        <PageHeader title="Posts" />
        {canWrite && site ? (
          <Link href="/websites/posts/new" className="mt-0.5 inline-flex min-h-11 items-center rounded-md bg-accent px-3.5 text-sm font-semibold text-white">
            + Add new
          </Link>
        ) : null}
      </div>
      <Flash error={query.error} notice={query.notice} />
      {site ? (
        <>
          <SiteBar sites={sites} site={site} back="/websites/posts" />
          <PostList organizationId={ctx.resolved.id} brandId={ctx.brand.id} site={site} kind="post" query={query} canWrite={canWrite} />
        </>
      ) : (
        <NoSite />
      )}
    </div>
  );
}
