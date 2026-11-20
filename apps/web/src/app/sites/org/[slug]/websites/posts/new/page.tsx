import { notFound } from "next/navigation";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { NoSite, SiteBar } from "@/features/websites/admin-ui";
import { PostEditor } from "@/features/websites/editor";
import { websitesAccess } from "@/features/websites/guard";

export default async function NewPostPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await websitesAccess(slug, "websites.write");
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx, sites, site, canPublish, canWrite } = access;
  return (
    <div>
      <PageHeader title="Add new post" />
      <Flash error={query.error} notice={query.notice} />
      {site ? (
        <>
          <SiteBar sites={sites} site={site} back="/websites/posts" />
          <PostEditor organizationId={ctx.resolved.id} brandId={ctx.brand.id} site={site} post={null} kind="post" canPublish={canPublish} canWrite={canWrite} />
        </>
      ) : (
        <NoSite />
      )}
    </div>
  );
}
