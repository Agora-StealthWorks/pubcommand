import { can } from "@pubcommand/core";
import { tenantDb } from "@pubcommand/db";
import { moduleRegistry } from "@pubcommand/modules";
import { notFound } from "next/navigation";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { getOrgContext } from "@/lib/org";
import { toggleModule } from "@/server/org-actions";

export default async function ModulesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") notFound();
  if (!can(ctx.subject, "settings.modules.manage", ctx.scope)) return <Denied />;
  const organization = await tenantDb(ctx.resolved.id).organization.findUnique({
    where: { id: ctx.resolved.id },
    include: { plan: { include: { modules: true } }, modules: true },
  });
  if (!organization) notFound();
  const planModules = new Set(organization.plan.modules.map((row) => row.moduleId));
  return (
    <div>
      <PageHeader title="Modules" description={`${organization.plan.name} plan. Settings stays available so the organization cannot lock itself out.`} />
      <Flash error={query.error} notice={query.notice} />
      <ul className="divide-y divide-line rounded-lg border border-line bg-white">
        {moduleRegistry.all().map((manifest) => {
          const onPlan = manifest.id === "settings" || planModules.has(manifest.id);
          const toggle = organization.modules.find((row) => row.moduleId === manifest.id);
          const enabled = manifest.id === "settings" || (onPlan && (toggle ? toggle.enabled : true));
          return (
            <li key={manifest.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0">
                <p className="font-semibold">{manifest.name}</p>
                <p className="pc-break text-muted">/{manifest.slug} · {onPlan ? "on plan" : "not on plan"}</p>
              </div>
              {onPlan && manifest.id !== "settings" ? (
                <form action={toggleModule}>
                  <input type="hidden" name="moduleId" value={manifest.id} />
                  <input type="hidden" name="enabled" value={enabled ? "0" : "1"} />
                  <button className="inline-flex min-h-11 items-center font-semibold text-accent">{enabled ? "Enabled" : "Disabled"}</button>
                </form>
              ) : (
                <span className="text-muted">{enabled ? "Always on" : "Unavailable"}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
