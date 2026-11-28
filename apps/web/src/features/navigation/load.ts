import { rawPrisma } from "@pubcommand/db";
import { readStaff, rootDomain, staffReady } from "@/lib/auth";
import { CONSOLE_ORG_SLUG } from "@/lib/console-workspace";
import { currentRequest } from "@/lib/request";
import { buildSwitcher, type SwitcherHere, type SwitcherInput, type SwitcherModel } from "./switcher";

const orgSelect = {
  slug: true,
  name: true,
  suspendedAt: true,
  brands: { select: { id: true, name: true }, orderBy: { name: "asc" as const } },
} as const;

/**
 * The switcher for the signed-in person (never someone staff is viewing as): their own
 * organizations with the brands they can work in, and staff access. The super admin (two-factor
 * done) also gets every other organization, since they can open any of them.
 */
export async function loadSwitcher(input: { userId: string; session: { mfaVerified: boolean } | null; here: SwitcherHere }): Promise<SwitcherModel> {
  const [request, staff, memberships] = await Promise.all([
    currentRequest(),
    readStaff(input.userId),
    rawPrisma().membership.findMany({
      where: { userId: input.userId, status: "ACTIVE", organization: { deletedAt: null } },
      select: { brandId: true, organization: { select: orgSelect } },
      orderBy: { organization: { name: "asc" } },
    }),
  ]);
  const ready = staff ? staffReady(staff, input.session) : false;
  const organizations: SwitcherInput["organizations"] = memberships.map(({ brandId, organization }) => ({
    slug: organization.slug,
    name: organization.name,
    suspended: Boolean(organization.suspendedAt),
    // A membership limited to one brand only works in that brand.
    brands: brandId ? organization.brands.filter((brand) => brand.id === brandId) : organization.brands,
    member: true,
  }));
  if (staff?.role === "SUPER_ADMIN" && ready) {
    const memberSlugs = organizations.map((org) => org.slug);
    const others = await rawPrisma().organization.findMany({
      where: { deletedAt: null, slug: { notIn: [...memberSlugs, CONSOLE_ORG_SLUG] } },
      select: orgSelect,
      orderBy: { name: "asc" },
    });
    organizations.push(
      ...others.map((organization) => ({
        slug: organization.slug,
        name: organization.name,
        suspended: Boolean(organization.suspendedAt),
        brands: organization.brands,
        member: false,
      })),
    );
    organizations.sort((a, b) => a.name.localeCompare(b.name));
  }
  return buildSwitcher({
    here: input.here,
    organizations,
    staff: staff ? { ready } : null,
    rootDomain: rootDomain(),
    requestHost: request.host,
  });
}
