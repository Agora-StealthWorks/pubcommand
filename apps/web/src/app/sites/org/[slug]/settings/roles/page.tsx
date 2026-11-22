import { can, LOCKED_ROLE_SLUGS } from "@pubcommand/core";
import { Button, Input } from "@pubcommand/ui";
import { tenantDb } from "@pubcommand/db";
import { notFound } from "next/navigation";
import { RoleAccessTable, type RoleColumn } from "@/components/role-access-table";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { getOrgContext } from "@/lib/org";
import { roleAccessSections } from "@/lib/role-access";
import { createRole, deleteRole, renameRole, saveRoleAccess } from "@/server/org-actions";

/** Built-in roles first, from most to least access; custom roles after, by name. */
const BUILT_IN_ORDER = ["owner", "admin", "editor", "user"];

export default async function RolesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string; notice?: string; saved?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") notFound();
  if (!can(ctx.subject, "settings.roles.manage", ctx.scope)) return <Denied />;
  const db = tenantDb(ctx.resolved.id);
  const [rows, memberCounts] = await Promise.all([
    db.role.findMany({ include: { grants: true }, orderBy: { name: "asc" } }),
    db.membership.findMany({ where: { status: { in: ["ACTIVE", "INVITED"] } }, select: { roleId: true } }),
  ]);
  const rank = (roleSlug: string) => {
    const index = BUILT_IN_ORDER.indexOf(roleSlug);
    return index === -1 ? BUILT_IN_ORDER.length : index;
  };
  const roles = [...rows].sort((a, b) => rank(a.slug) - rank(b.slug) || a.name.localeCompare(b.name));
  const brandName = (brandId: string | null) => (brandId ? ctx.brands.find((brand) => brand.id === brandId)?.name ?? "one brand" : null);
  const columns: RoleColumn[] = roles.map((role) => ({
    id: role.id,
    name: role.name,
    locked: LOCKED_ROLE_SLUGS.includes(role.slug),
    mine: role.id === ctx.subject.roleId,
    note: LOCKED_ROLE_SLUGS.includes(role.slug)
      ? "Always everything"
      : [brandName(role.brandId) ? `${brandName(role.brandId)} only` : null, role.id === ctx.subject.roleId ? "Your role" : null].filter(Boolean).join(" · ") || undefined,
  }));
  const { included, notIncluded } = roleAccessSections(ctx.subject.entitledModuleIds);
  const people = (roleId: string) => memberCounts.filter((row) => row.roleId === roleId).length;
  const custom = roles.filter((role) => !role.isSystem);

  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        title="Roles & access"
        description="What each role can do, app by app. View lets people look; Edit also lets them add and change things; Manage adds the app's admin tools. You can still raise or lower one person's access from their profile in Users."
      />
      <Flash error={query.error} notice={query.saved ? undefined : query.notice} />

      <details className="rounded-xl border border-line bg-white p-4">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-accent">Add or manage roles</summary>
        <form action={createRole} className="pc-form-row mt-3">
          <Input name="name" required maxLength={60} placeholder="Role name" aria-label="New role name" className="md:max-w-xs" />
          <select name="brandId" aria-label="Applies to" className="pc-control w-full md:w-auto">
            <option value="">Whole organization</option>
            {ctx.brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name} only
              </option>
            ))}
          </select>
          <Button type="submit" variant="secondary" className="w-full md:w-auto">
            Add role
          </Button>
        </form>
        <p className="mt-2 text-sm text-muted">A new role starts with no access. Set it in the tables below.</p>
        {custom.length > 0 ? (
          <ul className="mt-3 divide-y divide-line">
            {custom.map((role) => (
              <li key={role.id} className="flex flex-col gap-2 py-3 md:flex-row md:items-center">
                <form action={renameRole} className="pc-form-row md:flex-1">
                  <input type="hidden" name="roleId" value={role.id} />
                  <Input name="name" required maxLength={60} defaultValue={role.name} aria-label={`Name of ${role.name}`} className="md:max-w-xs" />
                  <Button type="submit" variant="secondary" className="w-full md:w-auto">
                    Rename
                  </Button>
                </form>
                <span className="text-sm text-muted">
                  {people(role.id)} {people(role.id) === 1 ? "person" : "people"}
                </span>
                <form action={deleteRole}>
                  <input type="hidden" name="roleId" value={role.id} />
                  <button className="inline-flex min-h-11 items-center text-sm font-semibold text-[#b42318]">Delete</button>
                </form>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-2 text-xs text-muted">Owner, Admin, Editor and User are built in: they keep their names, and the Owner always has everything.</p>
      </details>

      {included.map((section) => {
        const keys = new Set(section.permissions.map((permission) => permission.key));
        const granted = Object.fromEntries(
          roles.map((role) => [
            role.id,
            role.grants.filter((grant) => grant.effect === "ALLOW" && keys.has(grant.permission)).map((grant) => grant.permission).sort(),
          ]),
        );
        const version = roles.map((role) => `${role.id}:${granted[role.id]!.join(",")}`).join(";");
        return (
          <RoleAccessTable
            key={`${section.id}-${version}`}
            section={section}
            roles={columns}
            granted={granted}
            action={saveRoleAccess}
            savedMessage={query.saved === section.id ? (query.notice ?? undefined) : undefined}
          />
        );
      })}

      {notIncluded.length > 0 ? (
        <details className="rounded-xl border border-line bg-white p-4">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-muted">
            Not in your plan or turned off ({notIncluded.length})
          </summary>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {notIncluded.map((app) => (
              <li key={app.id} className="flex items-center gap-2 text-sm text-muted">
                <span aria-hidden>{app.icon}</span>
                {app.name}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">Turn an app on in Settings → Apps, or ask PubCommand to add it. Its access can be set here once it is on.</p>
        </details>
      ) : null}
    </div>
  );
}
