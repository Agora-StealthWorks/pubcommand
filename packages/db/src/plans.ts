import { Prisma } from "@prisma/client";
import { UNLIMITED_PLAN_LIMIT } from "@pubcommand/core";
import { moduleRegistry } from "@pubcommand/modules";
import { rawPrisma } from "./client";
import { appendPlatformAudit } from "./platform";

const SETTINGS_MODULE = "settings";

export type PlanSeed = {
  key: string;
  name: string;
  seatLimit: number;
  brandLimit: number;
  workspaceLimit: number;
  monthlyPriceCents: number;
  moduleIds: readonly string[];
};

function catalogModuleIds(): string[] {
  return moduleRegistry
    .all()
    .map((manifest) => manifest.id)
    .filter((id) => id !== "example");
}

export const DEFAULT_PLANS: readonly PlanSeed[] = [
  {
    key: "starter",
    name: "Starter",
    seatLimit: 5,
    brandLimit: 1,
    workspaceLimit: 2,
    monthlyPriceCents: 0,
    moduleIds: ["knowledge", "editorial", "forms", "settings"],
  },
  {
    key: "pro",
    name: "Pro",
    seatLimit: 25,
    brandLimit: 5,
    workspaceLimit: 20,
    monthlyPriceCents: 4900,
    moduleIds: ["knowledge", "editorial", "performance", "promo-studio", "intel", "forms", "charts", "billing", "settings"],
  },
  {
    key: "enterprise",
    name: "Enterprise",
    seatLimit: 100,
    brandLimit: 25,
    workspaceLimit: 100,
    monthlyPriceCents: 14900,
    moduleIds: catalogModuleIds(),
  },
  {
    key: "internal",
    name: "Internal (unlimited)",
    seatLimit: UNLIMITED_PLAN_LIMIT,
    brandLimit: UNLIMITED_PLAN_LIMIT,
    workspaceLimit: UNLIMITED_PLAN_LIMIT,
    monthlyPriceCents: 0,
    moduleIds: catalogModuleIds(),
  },
];

function moduleSet(moduleIds: readonly string[], allowed?: readonly string[]): string[] {
  const permit = allowed ? new Set(allowed) : null;
  const next = new Set<string>([SETTINGS_MODULE]);
  for (const moduleId of moduleIds) {
    if (!moduleId || moduleId === SETTINGS_MODULE) continue;
    if (permit && !permit.has(moduleId)) throw new Error("Unknown module.");
    next.add(moduleId);
  }
  return [...next];
}

export async function insertPlanIfAbsent(plan: PlanSeed): Promise<"created" | "kept"> {
  const existing = await rawPrisma().plan.findUnique({ where: { key: plan.key }, select: { id: true } });
  if (existing) return "kept";
  const moduleIds = moduleSet(plan.moduleIds);
  try {
    await rawPrisma().$transaction(async (tx) => {
      const created = await tx.plan.create({
        data: {
          key: plan.key,
          name: plan.name,
          seatLimit: plan.seatLimit,
          brandLimit: plan.brandLimit,
          workspaceLimit: plan.workspaceLimit,
          monthlyPriceCents: plan.monthlyPriceCents,
        },
      });
      await tx.planModule.createMany({
        data: moduleIds.map((moduleId) => ({ planId: created.id, moduleId })),
      });
    });
    return "created";
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "kept";
    throw error;
  }
}

/** Insert any missing default plans. Existing rows keep their name, limits, price, and modules. */
export async function ensureDefaultPlans(): Promise<{ created: string[] }> {
  const created: string[] = [];
  for (const plan of DEFAULT_PLANS) {
    const result = await insertPlanIfAbsent(plan);
    if (result === "created") created.push(plan.key);
  }
  return { created };
}

type PlanWrite = {
  actorId: string;
  name: string;
  seatLimit: number;
  brandLimit: number;
  workspaceLimit: number;
  monthlyPriceCents: number;
  moduleIds: readonly string[];
  allowedModuleIds: readonly string[];
};

export async function createCatalogPlan(input: PlanWrite & { key: string }): Promise<{ id: string }> {
  const moduleIds = moduleSet(input.moduleIds, input.allowedModuleIds);
  try {
    const created = await rawPrisma().$transaction(async (tx) => {
      const plan = await tx.plan.create({
        data: {
          key: input.key,
          name: input.name,
          seatLimit: input.seatLimit,
          brandLimit: input.brandLimit,
          workspaceLimit: input.workspaceLimit,
          monthlyPriceCents: input.monthlyPriceCents,
        },
      });
      await tx.planModule.createMany({ data: moduleIds.map((moduleId) => ({ planId: plan.id, moduleId })) });
      return plan;
    });
    await appendPlatformAudit({
      actorId: input.actorId,
      action: "plan.created",
      targetType: "plan",
      targetId: created.id,
      metadata: { key: created.key, name: created.name, moduleIds },
    });
    return { id: created.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new Error("A plan with that name already exists.");
    }
    throw error;
  }
}

export async function updateCatalogPlan(input: PlanWrite & { planId: string }): Promise<void> {
  const existing = await rawPrisma().plan.findUnique({ where: { id: input.planId } });
  if (!existing) throw new Error("Unknown plan.");
  const moduleIds = moduleSet(input.moduleIds, input.allowedModuleIds);
  await rawPrisma().$transaction(async (tx) => {
    await tx.plan.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        seatLimit: input.seatLimit,
        brandLimit: input.brandLimit,
        workspaceLimit: input.workspaceLimit,
        monthlyPriceCents: input.monthlyPriceCents,
      },
    });
    await tx.planModule.deleteMany({ where: { planId: existing.id } });
    await tx.planModule.createMany({ data: moduleIds.map((moduleId) => ({ planId: existing.id, moduleId })) });
  });
  await appendPlatformAudit({
    actorId: input.actorId,
    action: "plan.updated",
    targetType: "plan",
    targetId: existing.id,
    metadata: { key: existing.key, name: input.name, moduleIds },
  });
}

export async function setPlanArchived(input: { actorId: string; planId: string; archived: boolean }): Promise<void> {
  const existing = await rawPrisma().plan.findUnique({ where: { id: input.planId } });
  if (!existing) throw new Error("Unknown plan.");
  await rawPrisma().plan.update({
    where: { id: existing.id },
    data: { archivedAt: input.archived ? new Date() : null },
  });
  await appendPlatformAudit({
    actorId: input.actorId,
    action: input.archived ? "plan.archived" : "plan.restored",
    targetType: "plan",
    targetId: existing.id,
    metadata: { key: existing.key },
  });
}
