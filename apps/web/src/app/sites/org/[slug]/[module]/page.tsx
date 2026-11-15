import { can } from "@pubcommand/core";
import { moduleRegistry } from "@pubcommand/modules";
import { notFound } from "next/navigation";
import { Denied, PageHeader } from "@/components/ui";
import { getOrgContext } from "@/lib/org";

export default async function ModulePage({ params }: { params: Promise<{ slug: string; module: string }> }) {
  const { slug, module: moduleSlug } = await params;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") notFound();
  const manifest = moduleRegistry.getBySlug(moduleSlug);
  if (!manifest || manifest.id === "settings") notFound();
  if (!ctx.subject.entitledModuleIds.includes(manifest.planEntitlement)) {
    return (
      <div>
        <PageHeader title={manifest.name} description="This module is not included for the organization." />
        <p className="rounded-lg border border-line bg-white p-6 text-sm text-muted">
          Ask an admin to enable it if the plan allows it. The module itself is not built in Phase 1.
        </p>
      </div>
    );
  }
  const allowed = manifest.permissions.some((permission) => can(ctx.subject, permission.key, ctx.scope));
  if (!allowed) return <Denied />;
  return (
    <div>
      <PageHeader title={manifest.name} description={manifest.description} />
      <p className="text-sm text-muted">Route /{manifest.slug}. No feature work is included in Phase 1.</p>
    </div>
  );
}
