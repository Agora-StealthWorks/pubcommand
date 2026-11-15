import { PLATFORM_PERMISSIONS, platformCan } from "@pubcommand/core";
import { rawPrisma } from "@pubcommand/db";
import { moduleRegistry } from "@pubcommand/modules";
import { Flash, PageHeader } from "@/components/ui";
import { readSession, readStaff } from "@/lib/auth";
import { assignPlan, togglePlanModule } from "@/server/platform-actions";

export default async function PlansPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const query = await searchParams;
  const auth = await readSession();
  const staff = auth.user ? await readStaff(auth.user.id) : null;
  const [plans, organizations] = await Promise.all([
    rawPrisma().plan.findMany({ include: { modules: true }, orderBy: { seatLimit: "asc" } }),
    rawPrisma().organization.findMany({ orderBy: { name: "asc" } }),
  ]);
  const canEdit = Boolean(staff && platformCan(staff.role, PLATFORM_PERMISSIONS.managePlans));
  const canModules = Boolean(staff && platformCan(staff.role, PLATFORM_PERMISSIONS.manageModules));
  return (
    <div>
      <PageHeader title="Plans" description="Assign a plan to an organization, or change which modules a plan includes." />
      <Flash error={query.error} notice={query.notice} />
      <ul className="space-y-4">
        {plans.map((plan) => (
          <li key={plan.id} className="rounded-lg border border-line bg-white p-4">
            <p className="font-semibold">{plan.name}</p>
            <p className="text-sm text-muted">{plan.seatLimit} seats · ${(plan.monthlyPriceCents / 100).toFixed(0)} / month · {plan.modules.map((row) => row.moduleId).join(", ")}</p>
            {canModules ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {moduleRegistry.all().filter((manifest) => manifest.id !== "settings").map((manifest) => {
                  const enabled = plan.modules.some((row) => row.moduleId === manifest.id);
                  return (
                    <form key={manifest.id} action={togglePlanModule}>
                      <input type="hidden" name="planId" value={plan.id} />
                      <input type="hidden" name="moduleId" value={manifest.id} />
                      <input type="hidden" name="enabled" value={enabled ? "0" : "1"} />
                      <button className="rounded-full border border-line px-2 py-1 text-xs">{manifest.name}: {enabled ? "on" : "off"}</button>
                    </form>
                  );
                })}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {canEdit ? (
        <form action={assignPlan} className="mt-6 flex flex-wrap gap-2">
          <select name="organizationId" className="h-10 rounded-md border border-line bg-white px-2 text-sm">
            {organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
          </select>
          <select name="planId" className="h-10 rounded-md border border-line bg-white px-2 text-sm">
            {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
          </select>
          <button className="rounded-md bg-accent px-3 text-sm font-semibold text-white">Assign plan</button>
        </form>
      ) : null}
    </div>
  );
}
