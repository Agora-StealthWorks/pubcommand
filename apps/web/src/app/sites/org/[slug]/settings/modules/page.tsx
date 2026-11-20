import { can, moduleAllowed } from "@pubcommand/core";
import { loadEntitlementState } from "@pubcommand/db";
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
  const state = await loadEntitlementState(ctx.resolved.id);
  if (!state) notFound();
  const catalog = appCatalog();
  const included = catalog.filter((app) => moduleAllowed(app.moduleId, state));
  const notIncluded = catalog.filter((app) => !moduleAllowed(app.moduleId, state));
  return (
    <div className="max-w-2xl">
      <PageHeader title="Apps" description="Turn apps on or off for everyone in this workspace. Turning an app off hides it but keeps its data." />
      <Flash error={query.error} notice={query.notice} />
      <ul className="divide-y divide-line rounded-lg border border-line bg-white">
        {included.map((app) => {
          const enabled = state.toggles[app.moduleId] !== false;
          return (
            <li key={app.moduleId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="flex min-w-0 items-center gap-3">
                <span className="text-xl" aria-hidden>
                  {app.icon}
                </span>
                <div className="min-w-0">
                  <p className="font-semibold">{app.name}</p>
                  <p className="pc-break text-muted">
                    {app.description}
                    {app.niches ? <span className="ml-1 text-xs">· Shows for {app.niches.join(", ")} brands only</span> : null}
                  </p>
                </div>
              </div>
              <form action={toggleModule}>
                <input type="hidden" name="moduleId" value={app.moduleId} />
                <input type="hidden" name="enabled" value={enabled ? "0" : "1"} />
                <button
                  aria-label={`${app.name} is ${enabled ? "on" : "off"}. Turn it ${enabled ? "off" : "on"}.`}
                  className={`inline-flex min-h-9 items-center rounded-full px-3 text-xs font-semibold ${
                    enabled ? "bg-[#ecfdf3] text-[#067647]" : "bg-canvas text-muted"
                  }`}
                >
                  {enabled ? "On" : "Off"}
                </button>
              </form>
            </li>
          );
        })}
        {included.length === 0 ? <li className="px-4 py-6 text-sm text-muted">No apps are included yet.</li> : null}
      </ul>
      {notIncluded.length > 0 ? (
        <>
          <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted">Not included</h2>
          <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-white">
            {notIncluded.map((app) => (
              <li key={app.moduleId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-muted">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="text-xl opacity-60" aria-hidden>
                    {app.icon}
                  </span>
                  <p className="font-semibold">{app.name}</p>
                </div>
                <span className="text-xs">Not included — ask PubCommand</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
