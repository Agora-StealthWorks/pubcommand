import { PLATFORM_PERMISSIONS, platformCan } from "@pubcommand/core";
import { rawPrisma } from "@pubcommand/db";
import { Button, Input } from "@pubcommand/ui";
import { Flash, PageHeader } from "@/components/ui";
import { readSession, readStaff } from "@/lib/auth";
import { startImpersonation, suspendOrganization } from "@/server/platform-actions";

export default async function OrgsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const query = await searchParams;
  const auth = await readSession();
  const staff = auth.user ? await readStaff(auth.user.id) : null;
  const organizations = await rawPrisma().organization.findMany({
    include: { plan: true, _count: { select: { memberships: true, brands: true, workspaces: true } } },
    orderBy: { name: "asc" },
  });
  return (
    <div>
      <PageHeader title="Organizations" description="Seats compare active memberships with the plan seat limit. Usage counts brands and workspaces." />
      <Flash error={query.error} notice={query.notice} />
      <div className="overflow-auto rounded-lg border border-line bg-white">
        <table className="min-w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2">Name</th><th>Slug</th><th>Plan</th><th>Seats</th><th>Usage</th><th></th>
            </tr>
          </thead>
          <tbody>
            {organizations.map((organization) => (
              <tr key={organization.id} className="border-t border-line align-top">
                <td className="px-3 py-3 font-semibold">{organization.name}</td>
                <td>{organization.slug}</td>
                <td>{organization.plan.name}</td>
                <td>{organization._count.memberships}/{organization.seatLimit}</td>
                <td>{organization._count.brands} brands · {organization._count.workspaces} workspaces</td>
                <td className="space-y-2 px-3 py-3">
                  {organization.suspendedAt ? <p className="text-[#b42318]">Suspended</p> : null}
                  {staff && platformCan(staff.role, PLATFORM_PERMISSIONS.suspendOrgs) ? (
                    <form action={suspendOrganization}>
                      <input type="hidden" name="organizationId" value={organization.id} />
                      <input type="hidden" name="suspend" value={organization.suspendedAt ? "0" : "1"} />
                      <Button type="submit" variant="secondary" size="sm">{organization.suspendedAt ? "Unsuspend" : "Suspend"}</Button>
                    </form>
                  ) : null}
                  {staff && platformCan(staff.role, PLATFORM_PERMISSIONS.impersonate) ? (
                    <form action={startImpersonation} className="flex gap-2">
                      <input type="hidden" name="organizationId" value={organization.id} />
                      <Input name="email" type="email" required placeholder="member@example.com" className="h-8" />
                      <Button type="submit" size="sm">Impersonate</Button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
