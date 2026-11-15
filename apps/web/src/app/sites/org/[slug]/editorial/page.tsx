import { can } from "@pubcommand/core";
import { moduleRegistry } from "@pubcommand/modules";
import { notFound } from "next/navigation";
import { renderEditorialPage } from "../../../../../../../../modules/editorial";
import { Denied, PageHeader } from "@/components/ui";
import { getOrgContext } from "@/lib/org";

export default async function EditorialPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ issue?: string; prompt?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") notFound();
  const manifest = moduleRegistry.getBySlug("editorial");
  if (!manifest) notFound();
  if (!ctx.subject.entitledModuleIds.includes(manifest.planEntitlement)) {
    return (
      <div>
        <PageHeader title={manifest.name} description="This module is not included for the organization." />
        <p className="rounded-lg border border-line bg-white p-6 text-sm text-muted">
          Ask an admin to enable it if the plan allows it.
        </p>
      </div>
    );
  }
  const allowed = manifest.permissions.some((permission) => can(ctx.subject, permission.key, ctx.scope));
  if (!allowed) return <Denied />;
  const html = await renderEditorialPage({
    organizationId: ctx.resolved.id,
    issueId: query.issue,
    prompt: query.prompt,
    canWrite: can(ctx.subject, "editorial.write", ctx.scope),
  });
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
