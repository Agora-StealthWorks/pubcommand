import { can } from "@pubcommand/core";
import { moduleRegistry } from "@pubcommand/modules";
import { notFound } from "next/navigation";
import { Denied, PageHeader } from "@/components/ui";
import { getOrgContext } from "@/lib/org";
import { FormsBuilder } from "./builder";

export default async function FormsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") notFound();
  const manifest = moduleRegistry.getById("forms");
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
  return (
    <div>
      <PageHeader title={manifest.name} description={manifest.description} />
      <FormsBuilder
        key={ctx.resolved.id}
        organizationId={ctx.resolved.id}
        canWrite={can(ctx.subject, "forms.write", ctx.scope)}
        canExport={can(ctx.subject, "forms.export", ctx.scope)}
      />
    </div>
  );
}
