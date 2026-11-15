import { moduleRegistry } from "@pubcommand/modules";
import { rawPrisma } from "../src/client";
import { ensureSuperadmin } from "../src/superadmin";

const db = rawPrisma();
const permissions = Object.keys(moduleRegistry.permissionModules());

const plans = [
  {
    key: "starter",
    name: "Starter",
    seatLimit: 5,
    monthlyPriceCents: 0,
    modules: ["knowledge", "editorial", "forms", "settings"],
  },
  {
    key: "team",
    name: "Team",
    seatLimit: 25,
    monthlyPriceCents: 4900,
    modules: [
      "knowledge",
      "editorial",
      "performance",
      "promo-studio",
      "intel",
      "forms",
      "charts",
      "billing",
      "settings",
    ],
  },
  {
    key: "enterprise",
    name: "Enterprise",
    seatLimit: 100,
    monthlyPriceCents: 14900,
    modules: moduleRegistry.all().map((manifest) => manifest.id),
  },
] as const;

async function seedPlan(plan: (typeof plans)[number]) {
  const row = await db.plan.upsert({
    where: { key: plan.key },
    create: {
      key: plan.key,
      name: plan.name,
      seatLimit: plan.seatLimit,
      monthlyPriceCents: plan.monthlyPriceCents,
    },
    update: {
      name: plan.name,
      seatLimit: plan.seatLimit,
      monthlyPriceCents: plan.monthlyPriceCents,
    },
  });
  await db.planModule.deleteMany({ where: { planId: row.id } });
  await db.planModule.createMany({
    data: plan.modules.map((moduleId) => ({ planId: row.id, moduleId })),
  });
  return row;
}

async function seedRole(
  organizationId: string,
  slug: string,
  name: string,
  granted: readonly string[],
) {
  const role = await db.role.upsert({
    where: { organizationId_slug: { organizationId, slug } },
    create: { organizationId, slug, name, isSystem: true },
    update: { name, isSystem: true },
  });
  await db.rolePermission.deleteMany({ where: { roleId: role.id } });
  if (granted.length > 0) {
    await db.rolePermission.createMany({
      data: granted.map((permission) => ({
        organizationId,
        roleId: role.id,
        permission,
        effect: "ALLOW",
      })),
    });
  }
  return role;
}

async function main() {
  const starter = await seedPlan(plans[0]);
  const team = await seedPlan(plans[1]);
  await seedPlan(plans[2]);

  const gazette = await db.organization.upsert({
    where: { slug: "example-gazette" },
    create: { name: "Example Gazette", slug: "example-gazette", planId: team.id, seatLimit: team.seatLimit },
    update: { name: "Example Gazette", planId: team.id, seatLimit: team.seatLimit },
  });
  const harbor = await db.organization.upsert({
    where: { slug: "example-harbor" },
    create: { name: "Example Harbor Media", slug: "example-harbor", planId: starter.id, seatLimit: starter.seatLimit },
    update: { name: "Example Harbor Media", planId: starter.id, seatLimit: starter.seatLimit },
  });

  const retired = await db.organizationSlugHistory.findUnique({ where: { slug: "example-daily" } });
  if (!retired) {
    await db.organizationSlugHistory.create({
      data: { organizationId: gazette.id, slug: "example-daily" },
    });
  }

  await db.orgSettings.upsert({
    where: { organizationId: gazette.id },
    create: {
      organizationId: gazette.id,
      displayName: "Example Gazette",
      timezone: "America/New_York",
      supportEmail: "desk@example-gazette.test",
    },
    update: { displayName: "Example Gazette" },
  });
  await db.orgSettings.upsert({
    where: { organizationId: harbor.id },
    create: {
      organizationId: harbor.id,
      displayName: "Example Harbor Media",
      timezone: "America/Chicago",
      supportEmail: "hello@example-harbor.test",
    },
    update: { displayName: "Example Harbor Media" },
  });

  for (const org of [gazette, harbor]) {
    const plan = org.id === gazette.id ? team : starter;
    const included = org.id === gazette.id ? plans[1].modules : plans[0].modules;
    await db.organizationModule.deleteMany({ where: { organizationId: org.id } });
    await db.organizationModule.createMany({
      data: included.map((moduleId) => ({ organizationId: org.id, moduleId, enabled: true })),
    });
    void plan;
  }

  const daily = await db.brand.upsert({
    where: { organizationId_slug: { organizationId: gazette.id, slug: "gazette-daily" } },
    create: { organizationId: gazette.id, name: "Gazette Daily", slug: "gazette-daily" },
    update: { name: "Gazette Daily" },
  });
  await db.brand.upsert({
    where: { organizationId_slug: { organizationId: gazette.id, slug: "gazette-sunday" } },
    create: { organizationId: gazette.id, name: "Gazette Sunday", slug: "gazette-sunday" },
    update: { name: "Gazette Sunday" },
  });
  const weekly = await db.brand.upsert({
    where: { organizationId_slug: { organizationId: harbor.id, slug: "harbor-weekly" } },
    create: { organizationId: harbor.id, name: "Harbor Weekly", slug: "harbor-weekly" },
    update: { name: "Harbor Weekly" },
  });

  for (const workspace of [
    { organizationId: gazette.id, brandId: daily.id, name: "Newsroom", slug: "newsroom" },
    { organizationId: gazette.id, brandId: daily.id, name: "Newsletters", slug: "newsletters" },
    { organizationId: harbor.id, brandId: weekly.id, name: "Desk", slug: "desk" },
  ]) {
    await db.workspace.upsert({
      where: { brandId_slug: { brandId: workspace.brandId, slug: workspace.slug } },
      create: workspace,
      update: { name: workspace.name },
    });
  }

  const readPermissions = permissions.filter((permission) => permission.endsWith(".read") || permission === "charts.read");
  const editorPermissions = [
    "knowledge.read",
    "knowledge.write",
    "editorial.read",
    "editorial.write",
    "forms.read",
    "forms.write",
    "charts.read",
    "performance.read",
    "promo.read",
    "promo.write",
    "promo.approve",
    "intel.read",
  ];

  const gazetteOwner = await seedRole(gazette.id, "owner", "Owner", permissions);
  const gazetteEditor = await seedRole(gazette.id, "editor", "Editor", editorPermissions);
  await seedRole(gazette.id, "analyst", "Analyst", readPermissions);
  const harborOwner = await seedRole(harbor.id, "owner", "Owner", permissions);
  await seedRole(harbor.id, "editor", "Editor", editorPermissions);

  async function user(email: string, name: string) {
    return db.user.upsert({
      where: { email },
      create: { email, name, passwordHash: null },
      update: { name },
    });
  }

  const ada = await user("ada.editor@example.com", "Ada Editor");
  const ben = await user("ben.admin@example.com", "Ben Admin");
  const stephen = await ensureSuperadmin();
  const stephenUser = await db.user.findUniqueOrThrow({ where: { id: stephen.userId } });

  async function membership(organizationId: string, userId: string, roleId: string) {
    await db.membership.upsert({
      where: { organizationId_userId: { organizationId, userId } },
      create: { organizationId, userId, roleId, status: "ACTIVE" },
      update: { roleId, status: "ACTIVE" },
    });
  }

  await membership(gazette.id, stephenUser.id, gazetteOwner.id);
  await membership(gazette.id, ada.id, gazetteEditor.id);
  await membership(harbor.id, ben.id, harborOwner.id);

  const existingExclusion = await db.exclusion.findFirst({
    where: { organizationId: gazette.id, userId: ada.id, permission: "promo.approve" },
  });
  if (!existingExclusion) {
    await db.exclusion.create({
      data: {
        organizationId: gazette.id,
        userId: ada.id,
        permission: "promo.approve",
        reason: "Example exclusion: Ada cannot approve promotions.",
      },
    });
  }

  const audit = await db.auditLog.findFirst({
    where: { organizationId: gazette.id, action: "seed.initialized" },
  });
  if (!audit) {
    await db.auditLog.create({
      data: {
        organizationId: gazette.id,
        actorId: stephenUser.id,
        action: "seed.initialized",
        targetType: "organization",
        targetId: gazette.id,
        metadata: { example: true },
      },
    });
  }

  console.log(
    JSON.stringify({
      ok: true,
      example: ["example-gazette", "example-harbor"],
      superadmin: stephenUser.email,
      password: null,
    }),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
