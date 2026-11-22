import { rawPrisma } from "@pubcommand/db";
import { readStaff, rootDomain, staffReady } from "@/lib/auth";
import { currentRequest } from "@/lib/request";
import { buildSwitcher, type SwitcherHere, type SwitcherModel } from "./switcher";

/** The switcher for the signed-in person (never someone staff is viewing as): their own organizations and staff access. */
export async function loadSwitcher(input: { userId: string; session: { mfaVerified: boolean } | null; here: SwitcherHere }): Promise<SwitcherModel> {
  const [request, staff, memberships] = await Promise.all([
    currentRequest(),
    readStaff(input.userId),
    rawPrisma().membership.findMany({
      where: { userId: input.userId, status: "ACTIVE", organization: { deletedAt: null } },
      select: { organization: { select: { slug: true, name: true, suspendedAt: true } } },
      orderBy: { organization: { name: "asc" } },
    }),
  ]);
  return buildSwitcher({
    here: input.here,
    organizations: memberships.map(({ organization }) => ({ slug: organization.slug, name: organization.name, suspended: Boolean(organization.suspendedAt) })),
    staff: staff ? { ready: staffReady(staff, input.session) } : null,
    rootDomain: rootDomain(),
    requestHost: request.host,
  });
}
