import { PLATFORM_PERMISSIONS, platformCan } from "@pubcommand/core";
import { rawPrisma, readDefaultAppsByNiche } from "@pubcommand/db";
import { moduleRegistry } from "@pubcommand/modules";
import { DefaultAppsForm } from "@/components/default-apps-form";
import { PlansConsole, type PlanRow } from "@/components/plans-console";
import { Flash, PageHeader } from "@/components/ui";
import { readSession, readStaff } from "@/lib/auth";
import { archivePlan, assignPlan, createPlan, saveDefaultApps, togglePlanModule, updatePlan } from "@/server/platform-actions";

export default async function PlansPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const query = await searchParams;
  const auth = await readSession();
  const staff = auth.user ? await readStaff(auth.user.id) : null;
  const [plans, organizations, defaultAppsByNiche] = await Promise.all([
    rawPrisma().plan.findMany({
      include: { modules: true, _count: { select: { organizations: true } } },
      orderBy: [{ archivedAt: "asc" }, { seatLimit: "asc" }],
    }),
    rawPrisma().organization.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    readDefaultAppsByNiche(),
  ]);
  const canEdit = Boolean(staff && platformCan(staff.role, PLATFORM_PERMISSIONS.managePlans));
  const canModules = Boolean(staff && platformCan(staff.role, PLATFORM_PERMISSIONS.manageModules));
  const modules = moduleRegistry
    .all()
    .filter((manifest) => manifest.id !== "settings" && manifest.id !== "example")
    .map((manifest) => ({ id: manifest.id, name: manifest.name }));
  const rows: PlanRow[] = plans.map((plan) => ({
    id: plan.id,
    key: plan.key,
    name: plan.name,
    seatLimit: plan.seatLimit,
    brandLimit: plan.brandLimit,
    workspaceLimit: plan.workspaceLimit,
    monthlyPriceCents: plan.monthlyPriceCents,
    archived: Boolean(plan.archivedAt),
    moduleIds: plan.modules.map((row) => row.moduleId),
    organizationCount: plan._count.organizations,
  }));
  return (
    <div>
      <PageHeader
        title="Plans"
        description="Create and edit plans. Seat, brand, and workspace limits describe what the plan includes. The price is display only and is not charged."
      />
      <Flash error={query.error} notice={query.notice} />
      <DefaultAppsForm modules={modules} byNiche={defaultAppsByNiche} canEdit={canModules} action={canModules ? saveDefaultApps : undefined} />
      <PlansConsole
        plans={rows}
        modules={modules}
        organizations={organizations}
        canEdit={canEdit}
        canModules={canModules}
        actions={{ create: createPlan, update: updatePlan, archive: archivePlan, assign: assignPlan, toggleModule: togglePlanModule }}
      />
    </div>
  );
}
