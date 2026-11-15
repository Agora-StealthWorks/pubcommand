import { can } from "@pubcommand/core";
import { moduleRegistry } from "@pubcommand/modules";
import { notFound } from "next/navigation";
import { Denied, PageHeader } from "@/components/ui";
import { getOrgContext } from "@/lib/org";
import { PromoStudioView } from "../../../../../../../../modules/promo-studio/view";

export default async function PromoStudioPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") notFound();
  const manifest = moduleRegistry.getBySlug("promo-studio");
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
  return <PromoStudioView organizationId={ctx.resolved.id} />;
}
