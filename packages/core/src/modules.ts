export type ModuleNavItem = {
  label: string;
  href: string;
  permission?: string;
};

export type ModuleManifest = {
  id: string;
  slug: string;
  name: string;
  description: string;
  nav: readonly ModuleNavItem[];
  routes: readonly { path: string; title: string }[];
  permissions: readonly { key: string; description: string }[];
  events: readonly { name: string; description: string }[];
  jobs: readonly { name: string; description: string }[];
  settingsSchema: Record<string, unknown>;
  planEntitlement: string;
};

export type DomainEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> = {
  name: string;
  organizationId: string;
  occurredAt: string;
  actorId?: string;
  payload: TPayload;
};

export type JobDefinition = {
  moduleId: string;
  name: string;
  description: string;
};

export function defineModule<T extends ModuleManifest>(manifest: T): T {
  if (manifest.slug !== manifest.id || manifest.planEntitlement !== manifest.id) {
    throw new Error(`Module ${manifest.id} must use the same id, slug, and plan entitlement`);
  }
  return manifest;
}

export function createModuleRegistry(modules: readonly ModuleManifest[]) {
  const ids = new Set<string>();
  const slugs = new Set<string>();
  const permissions = new Map<string, string>();
  for (const manifest of modules) {
    if (ids.has(manifest.id)) throw new Error(`Duplicate module id ${manifest.id}`);
    if (slugs.has(manifest.slug)) throw new Error(`Duplicate module slug ${manifest.slug}`);
    ids.add(manifest.id);
    slugs.add(manifest.slug);
    for (const permission of manifest.permissions) {
      if (permissions.has(permission.key)) throw new Error(`Duplicate permission ${permission.key}`);
      permissions.set(permission.key, manifest.planEntitlement);
    }
  }

  return {
    all: () => [...modules],
    getById: (id: string) => modules.find((manifest) => manifest.id === id) ?? null,
    getBySlug: (slug: string) => modules.find((manifest) => manifest.slug === slug) ?? null,
    permissionModules: (): Record<string, string> => Object.fromEntries(permissions),
    jobs: (): JobDefinition[] =>
      modules.flatMap((manifest) =>
        manifest.jobs.map((job) => ({
          moduleId: manifest.id,
          name: job.name,
          description: job.description,
        })),
      ),
  };
}
