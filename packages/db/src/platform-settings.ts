import { isNiche, NICHES, type Niche } from "@pubcommand/core";
import type { Prisma } from "@prisma/client";
import { rawPrisma } from "./client";
import { appendPlatformAudit } from "./platform";

const DEFAULT_APPS_KEY = "default_apps";

/** Stored value: { byNiche: { finance?: string[], health?: string[], general?: string[] } }. An older { enabled } applies to every niche. */
type DefaultAppsValue = { byNiche?: Partial<Record<string, unknown>>; enabled?: unknown };

function idList(value: unknown): string[] | null {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : null;
}

/** The saved default apps for every niche (null = not set for that niche: every plan app starts on). */
export async function readDefaultAppsByNiche(
  client: Pick<Prisma.TransactionClient, "platformSetting"> = rawPrisma(),
): Promise<Record<Niche, string[] | null>> {
  const row = await client.platformSetting.findUnique({ where: { key: DEFAULT_APPS_KEY } });
  const value = (row?.value ?? {}) as DefaultAppsValue;
  const legacy = idList(value.enabled);
  return Object.fromEntries(NICHES.map((niche) => [niche, idList(value.byNiche?.[niche]) ?? legacy])) as Record<Niche, string[] | null>;
}

/**
 * The apps a new organization of this niche starts with switched on (Admin → Plans → Default apps).
 * Null when staff never set it for the niche: then every app on the plan starts on.
 * Apps on the plan but not in this list start switched off; the org can turn them on.
 */
export async function readDefaultAppIds(
  client: Pick<Prisma.TransactionClient, "platformSetting"> = rawPrisma(),
  niche: Niche = "general",
): Promise<string[] | null> {
  return (await readDefaultAppsByNiche(client))[niche];
}

export async function saveDefaultAppIds(input: {
  actorId: string;
  niche: string;
  moduleIds: readonly string[];
  allowedModuleIds: readonly string[];
}): Promise<string[]> {
  if (!isNiche(input.niche)) throw new Error("Unknown niche.");
  const allowed = new Set(input.allowedModuleIds);
  const enabled = [...new Set(input.moduleIds)].filter((id) => allowed.has(id)).sort();
  const current = await readDefaultAppsByNiche();
  const byNiche: Record<string, string[]> = {};
  for (const niche of NICHES) {
    const list = niche === input.niche ? enabled : current[niche];
    if (list) byNiche[niche] = list;
  }
  await rawPrisma().platformSetting.upsert({
    where: { key: DEFAULT_APPS_KEY },
    create: { key: DEFAULT_APPS_KEY, value: { byNiche }, updatedById: input.actorId },
    update: { value: { byNiche }, updatedById: input.actorId },
  });
  await appendPlatformAudit({
    actorId: input.actorId,
    action: "platform.default_apps.changed",
    targetType: "platform",
    targetId: `${DEFAULT_APPS_KEY}:${input.niche}`,
    metadata: { niche: input.niche, enabled: enabled.join(",") },
  });
  return enabled;
}
