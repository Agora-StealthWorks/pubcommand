import type { Prisma } from "@prisma/client";
import { rawPrisma } from "./client";
import { appendPlatformAudit } from "./platform";

const DEFAULT_APPS_KEY = "default_apps";

/**
 * The apps a new organization starts with switched on (Admin → Plans → Default apps).
 * Null when staff never set it: then every app on the plan starts on, as before.
 * Apps on the plan but not in this list start switched off; the org can turn them on.
 */
export async function readDefaultAppIds(client: Pick<Prisma.TransactionClient, "platformSetting"> = rawPrisma()): Promise<string[] | null> {
  const row = await client.platformSetting.findUnique({ where: { key: DEFAULT_APPS_KEY } });
  const value = row?.value as { enabled?: unknown } | undefined;
  if (!value || !Array.isArray(value.enabled)) return null;
  return value.enabled.filter((id): id is string => typeof id === "string");
}

export async function saveDefaultAppIds(input: { actorId: string; moduleIds: readonly string[]; allowedModuleIds: readonly string[] }): Promise<string[]> {
  const allowed = new Set(input.allowedModuleIds);
  const enabled = [...new Set(input.moduleIds)].filter((id) => allowed.has(id)).sort();
  await rawPrisma().platformSetting.upsert({
    where: { key: DEFAULT_APPS_KEY },
    create: { key: DEFAULT_APPS_KEY, value: { enabled }, updatedById: input.actorId },
    update: { value: { enabled }, updatedById: input.actorId },
  });
  await appendPlatformAudit({
    actorId: input.actorId,
    action: "platform.default_apps.changed",
    targetType: "platform",
    targetId: DEFAULT_APPS_KEY,
    metadata: { enabled: enabled.join(",") },
  });
  return enabled;
}
