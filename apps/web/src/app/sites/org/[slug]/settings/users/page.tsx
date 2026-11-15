import { can } from "@pubcommand/core";
import { Button, Input } from "@pubcommand/ui";
import { moduleRegistry } from "@pubcommand/modules";
import { tenantDb } from "@pubcommand/db";
import { notFound } from "next/navigation";
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
      <form action={inviteUser} className="mb-6 flex flex-wrap items-end gap-2">
        <Input name="email" type="email" required placeholder="person@example.com" className="max-w-xs" />
        <select name="roleId" className="h-10 rounded-md border border-line bg-white px-2 text-sm">
          {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
        </select>
        <Button type="submit">Invite</Button>
      </form>
      <table className="w-full border-collapse overflow-hidden rounded-lg border border-line bg-white text-sm">
        <thead className="bg-canvas text-left text-xs uppercase tracking-wide text-muted">
          <tr><th className="px-3 py-2">Email</th><th>Role</th><th>Status</th><th>Exclusion</th></tr>
        </thead>
        <tbody>
          {memberships.map((membership) => (
            <tr key={membership.id} className="border-t border-line">
              <td className="px-3 py-2">{membership.user.email}</td>
              <td>{membership.role.name}</td>
              <td>{membership.status}</td>
              <td className="py-2 pr-3">
                <form action={addExclusion} className="flex gap-2">
                  <input type="hidden" name="userId" value={membership.userId} />
                  <select name="permission" className="h-8 rounded-md border border-line px-2">
                    {permissions.map((permission) => <option key={permission.key}>{permission.key}</option>)}
                  </select>
                  <button className="text-xs font-semibold text-accent">Block</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
