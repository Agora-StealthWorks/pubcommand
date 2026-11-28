import { rawPrisma } from "@pubcommand/db";
import { readStaff, rootDomain, staffReady } from "@/lib/auth";
import { CONSOLE_ORG_SLUG } from "@/lib/console-workspace";
import { currentRequest } from "@/lib/request";
import { buildSwitcher, type SwitcherHere, type SwitcherInput, type SwitcherModel } from "./switcher";

const orgSelect = { slug: true, name: true, suspendedAt: true } as const;

/**
 * The switcher for the signed-in person (never someone staff is viewing as): their own
 * organizations and staff access. The super admin (two-factor
 * done) also gets every other organization, since they can open any of them.
 */
export async function loadSwitcher(input: { userId: string; session: { mfaVerified: boolean } | null; here: SwitcherHere }): Promise<SwitcherModel> {
  const [request, staff, memberships] = await Promise.all([
    currentRequest(),
    readStaff(input.userId),
    rawPrisma().membership.findMany({
      where: { userId: input.userId, status: "ACTIVE", organization: { deletedAt: null } },
      select: { organization: { select: orgSelect } },
      orderBy: { organization: { name: "asc" } },
    }),
  ]);
  const ready = staff ? staffReady(staff, input.session) : false;
  const organizations: SwitcherInput["organizations"] = memberships.map(({ organization }) => ({
    slug: organization.slug,
    name: organization.name,
    suspended: Boolean(organization.suspendedAt),
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
