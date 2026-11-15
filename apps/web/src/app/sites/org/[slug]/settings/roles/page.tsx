import { can } from "@pubcommand/core";
import { Button, Input } from "@pubcommand/ui";
import { moduleRegistry } from "@pubcommand/modules";
import { tenantDb } from "@pubcommand/db";
import { notFound } from "next/navigation";
import { TableScroll } from "@/components/table-scroll";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { getOrgContext } from "@/lib/org";
import { createRole, toggleGrant } from "@/server/org-actions";

export default async function RolesPage({
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
  if (!can(ctx.subject, "settings.roles.manage", ctx.scope)) return <Denied />;
  const roles = await tenantDb(ctx.resolved.id).role.findMany({ include: { grants: true }, orderBy: { name: "asc" } });
  const permissions = moduleRegistry.all().flatMap((manifest) => manifest.permissions);
  return (
    <div>
      <PageHeader title="Roles and permissions" description="A grant is not enough by itself. The plan must entitle the module, and no exclusion may block it." />
      <Flash error={query.error} notice={query.notice} />
      <form action={createRole} className="pc-form-row mb-6">
        <Input name="name" required placeholder="Role name" className="md:max-w-xs" />
        <select name="brandId" className="pc-control w-full md:w-auto">
          <option value="">Whole organization</option>
          {ctx.brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
        </select>
        <Button type="submit" variant="secondary" className="w-full md:w-auto">Create role</Button>
      </form>
      <TableScroll>
        <table className="min-w-[40rem] w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-3 py-2">Permission</th>
              {roles.map((role) => <th key={role.id} className="px-3 py-2">{role.name}{role.brandId ? " (brand)" : ""}</th>)}
            </tr>
          </thead>
          <tbody>
            {permissions.map((permission) => (
              <tr key={permission.key} className="border-t border-line">
                <td className="pc-break px-3 py-2 font-medium">{permission.key}</td>
                {roles.map((role) => {
                  const enabled = role.grants.some((grant) => grant.permission === permission.key && grant.effect === "ALLOW");
                  return (
                    <td key={role.id} className="px-3 py-2">
                      <form action={toggleGrant}>
                        <input type="hidden" name="roleId" value={role.id} />
                        <input type="hidden" name="permission" value={permission.key} />
                        <input type="hidden" name="enabled" value={enabled ? "0" : "1"} />
                        <button className={`inline-flex min-h-11 items-center ${enabled ? "font-semibold text-[#067647]" : "text-muted"}`}>{enabled ? "Allow" : "Off"}</button>
                      </form>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </div>
  );
}
