import { can } from "@pubcommand/core";
import { Button, Input } from "@pubcommand/ui";
import { moduleRegistry } from "@pubcommand/modules";
import { tenantDb } from "@pubcommand/db";
import { notFound } from "next/navigation";
import { TableScroll } from "@/components/table-scroll";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { getOrgContext } from "@/lib/org";
import { addExclusion, inviteUser } from "@/server/org-actions";

export default async function UsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") notFound();
  if (!can(ctx.subject, "settings.users.manage", ctx.scope)) return <Denied />;
  const [memberships, roles] = await Promise.all([
    tenantDb(ctx.resolved.id).membership.findMany({ include: { user: true, role: true }, orderBy: { createdAt: "asc" } }),
    tenantDb(ctx.resolved.id).role.findMany({ orderBy: { name: "asc" } }),
  ]);
  const permissions = moduleRegistry.all().flatMap((manifest) => manifest.permissions);
  return (
    <div>
      <PageHeader title="Users" description="Invites send a magic link. There is no seeded password." />
      <Flash error={query.error} notice={query.notice} />
      <form action={inviteUser} className="pc-form-row mb-6">
        <Input name="email" type="email" required placeholder="person@example.com" className="md:max-w-xs" />
        <select name="roleId" className="pc-control w-full md:w-auto">
          {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
        </select>
        <Button type="submit" className="w-full md:w-auto">Invite</Button>
      </form>
      <TableScroll>
      <table className="w-full min-w-[40rem] border-collapse text-sm">
        <thead className="bg-canvas text-left text-xs uppercase tracking-wide text-muted">
          <tr><th className="px-3 py-2">Email</th><th>Role</th><th>Status</th><th>Exclusion</th></tr>
        </thead>
        <tbody>
          {memberships.map((membership) => (
            <tr key={membership.id} className="border-t border-line">
              <td className="pc-break px-3 py-2">{membership.user.email}</td>
              <td>{membership.role.name}</td>
              <td>{membership.status}</td>
              <td className="py-2 pr-3">
                <form action={addExclusion} className="pc-form-row">
                  <input type="hidden" name="userId" value={membership.userId} />
                  <select name="permission" className="pc-control w-full">
                    {permissions.map((permission) => <option key={permission.key}>{permission.key}</option>)}
                  </select>
                  <button className="inline-flex min-h-11 items-center text-sm font-semibold text-accent">Block</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </TableScroll>
    </div>
  );
}
