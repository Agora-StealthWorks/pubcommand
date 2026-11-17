/**
 * "Things a custom domain can point at." Each public app contributes a provider
 * that lists the organization's public pages it owns. Settings → Domains shows
 * them grouped by provider, and always also accepts a raw path (validated by
 * `normalizeTargetPath`), so a page type without a provider is still reachable.
 *
 * Providers:
 *   forms     /f/<slug>      published (OPEN) forms — implemented
 *   funnels   /l/<slug>      published launch funnels
 *   textsites /t/<slug>      live text-letter sites
 *
 * To add a provider: implement `TargetProvider.list` with `tenantDb(orgId)`
 * (only published/public rows, not soft-deleted), give each target the exact
 * path its public page answers on under the org host, and add it to
 * `TARGET_PROVIDERS`. Paths must start with a prefix in
 * `TARGET_PREFIXES` (modules/settings/domains/routing.ts); the middleware
 * already rewrites `/l/…` and `/t/…` on custom hosts.
 */

import { tenantDb } from "@pubcommand/db";

export type DomainTarget = { id: string; label: string; path: string; detail?: string };

export type TargetProvider = {
  id: string;
  label: string;
  /** Path prefix this provider's targets live under, e.g. "/f/". */
  prefix: string;
  list(organizationId: string): Promise<DomainTarget[]>;
};

export const formsTargets: TargetProvider = {
  id: "forms",
  label: "Forms",
  prefix: "/f/",
  async list(organizationId) {
    const forms = await tenantDb(organizationId).form.findMany({
      where: { status: "OPEN", deletedAt: null },
      orderBy: { title: "asc" },
      select: { id: true, title: true, slug: true },
      take: 200,
    });
    return forms.map((form) => ({ id: `form:${form.id}`, label: form.title, path: `/f/${form.slug}`, detail: `/f/${form.slug}` }));
  },
};

export const funnelTargets: TargetProvider = {
  id: "funnels",
  label: "Launch funnels",
  prefix: "/l/",
  async list(organizationId) {
    const rows = await tenantDb(organizationId).funnel.findMany({
      where: { status: "published", deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, slug: true },
      take: 200,
    });
    return rows.map((row) => ({ id: `funnel:${row.id}`, label: row.name, path: `/l/${row.slug}`, detail: `/l/${row.slug}` }));
  },
};

export const textSiteTargets: TargetProvider = {
  id: "textsites",
  label: "Text-letter sites",
  prefix: "/t/",
  async list(organizationId) {
    const rows = await tenantDb(organizationId).textSite.findMany({
      where: { status: "live", deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, slug: true },
      take: 200,
    });
    return rows.map((row) => ({ id: `textsite:${row.id}`, label: row.name, path: `/t/${row.slug}`, detail: `/t/${row.slug}` }));
  },
};

export const TARGET_PROVIDERS: TargetProvider[] = [formsTargets, funnelTargets, textSiteTargets];

export type TargetGroup = { id: string; label: string; targets: DomainTarget[]; error?: string };

/** Every provider's targets. One failing provider never hides the others. */
export async function listDomainTargets(organizationId: string, providers = TARGET_PROVIDERS): Promise<TargetGroup[]> {
  return Promise.all(
    providers.map(async (provider) => {
      try {
        return { id: provider.id, label: provider.label, targets: await provider.list(organizationId) };
      } catch (error) {
        return { id: provider.id, label: provider.label, targets: [], error: error instanceof Error ? error.message : "Could not load" };
      }
    }),
  );
}

/** The label of a chosen path, if a provider knows it ("Forms: Reader survey"). */
export function labelForPath(groups: TargetGroup[], path: string): string | null {
  for (const group of groups) {
    const target = group.targets.find((item) => item.path === path);
    if (target) return `${group.label}: ${target.label}`;
  }
  return null;
}
