import { can } from "@pubcommand/core";
import { tenantDb } from "@pubcommand/db";
import { notFound } from "next/navigation";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { appCatalog } from "@/lib/apps";
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
    <div className="max-w-2xl">
      <PageHeader title="Apps" description="Turn apps on or off for everyone in this workspace." />
      <Flash error={query.error} notice={query.notice} />
      <ul className="divide-y divide-line rounded-lg border border-line bg-white">
        {appCatalog().map((app) => {
          const onPlan = planModules.has(app.moduleId);
          const toggle = organization.modules.find((row) => row.moduleId === app.moduleId);
          const enabled = onPlan && (toggle ? toggle.enabled : true);
          return (
            <li key={app.moduleId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="flex min-w-0 items-center gap-3">
                <span className="text-xl" aria-hidden>
                  {app.icon}
                </span>
                <div className="min-w-0">
                  <p className="font-semibold">{app.name}</p>
                  <p className="pc-break text-muted">{app.description}</p>
                </div>
              </div>
              {onPlan ? (
                <form action={toggleModule}>
                  <input type="hidden" name="moduleId" value={app.moduleId} />
                  <input type="hidden" name="enabled" value={enabled ? "0" : "1"} />
                  <button
                    className={`inline-flex min-h-9 items-center rounded-full px-3 text-xs font-semibold ${
                      enabled ? "bg-[#ecfdf3] text-[#067647]" : "bg-canvas text-muted"
                    }`}
                  >
                    {enabled ? "On" : "Off"}
                  </button>
                </form>
              ) : (
                <span className="text-muted">Not available</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
