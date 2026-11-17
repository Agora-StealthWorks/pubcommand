import { tenantDb } from "@pubcommand/db";
import { componentSpec, parseDirection, type ClaimFlag } from "../../../../../modules/promo-studio/packager";
import { isGenStale } from "./server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID.test(value);

export type PackageListItem = {
  id: string;
  title: string;
  status: string;
  createdAt: Date;
  total: number;
  approved: number;
  busy: number;
  failed: number;
};

/** Packages for one promo, newest first, with component counts. */
export async function listPackages(organizationId: string, promoId: string): Promise<PackageListItem[]> {
  if (!isUuid(promoId)) return [];
  const db = tenantDb(organizationId);
  const packages = await db.promoPackage.findMany({
    where: { promoId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, status: true, createdAt: true },
  });
  if (!packages.length) return [];
  const components = await db.promoPackageComponent.findMany({
    where: { packageId: { in: packages.map((p) => p.id) } },
    select: { packageId: true, status: true, genStatus: true, updatedAt: true },
  });
  return packages.map((pkg) => {
    const own = components.filter((c) => c.packageId === pkg.id);
    return {
      ...pkg,
      total: own.length,
      approved: own.filter((c) => c.status === "APPROVED").length,
      busy: own.filter((c) => (c.genStatus === "QUEUED" || c.genStatus === "RUNNING") && !isGenStale(c.genStatus, c.updatedAt)).length,
      failed: own.filter((c) => c.genStatus === "FAILED" || isGenStale(c.genStatus, c.updatedAt)).length,
    };
  });
}

export type LoadedComponent = {
  id: string;
  kind: string;
  label: string;
  group: string;
  quantity: number;
  content: string;
  status: "DRAFT" | "NEEDS_EDITS" | "APPROVED";
  genStatus: "NONE" | "QUEUED" | "RUNNING" | "DONE" | "FAILED";
  genError: string | null;
  flags: ClaimFlag[];
  currentVersion: number;
  updatedAt: Date;
};

/** One package (scoped to the brand and promo) with its components in order. */
export async function loadPackage(organizationId: string, brandId: string, promoId: string, packageId: string) {
  if (!isUuid(promoId) || !isUuid(packageId)) return null;
  const db = tenantDb(organizationId);
  const pkg = await db.promoPackage.findFirst({ where: { id: packageId, promoId, brandId, deletedAt: null } });
  if (!pkg) return null;
  const promo = await db.promo.findFirst({ where: { id: promoId, brandId, deletedAt: null }, select: { id: true, title: true, sourceText: true } });
  if (!promo) return null;
  const rows = await db.promoPackageComponent.findMany({ where: { packageId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
  const components: LoadedComponent[] = rows.map((row) => {
    const stale = isGenStale(row.genStatus, row.updatedAt);
    const spec = componentSpec(row.kind);
    return {
      id: row.id,
      kind: row.kind,
      label: spec?.label ?? row.kind,
      group: spec?.group ?? "Other",
      quantity: row.quantity,
      content: row.content,
      status: row.status,
      genStatus: stale ? "FAILED" : row.genStatus,
      genError: stale ? "Interrupted (the server restarted). Write it again." : row.genError,
      flags: Array.isArray(row.flags) ? (row.flags as unknown as ClaimFlag[]) : [],
      currentVersion: row.currentVersion,
      updatedAt: row.updatedAt,
    };
  });
  return { pkg: { ...pkg, direction: parseDirection(pkg.direction) }, promo, components };
}

export type LoadedPackage = NonNullable<Awaited<ReturnType<typeof loadPackage>>>;

export async function loadVersions(organizationId: string, componentId: string) {
  return tenantDb(organizationId).promoPackageComponentVersion.findMany({
    where: { componentId },
    orderBy: { version: "desc" },
    select: { id: true, version: true, source: true, feedback: true, model: true, createdAt: true, content: true },
    take: 50,
  });
}
