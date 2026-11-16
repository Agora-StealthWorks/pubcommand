import { PLATFORM_ROLES, PLATFORM_STAFF_MANAGER_EMAIL } from "@pubcommand/core";
import { Button, Input, Label } from "@pubcommand/ui";
import Link from "next/link";

type FormAction = (formData: FormData) => void | Promise<void>;

export type UserListRow = {
  id: string;
  email: string;
  name: string | null;
  disabled: boolean;
  staffRole: string | null;
  organizations: string;
};

const linkClass = "inline-flex min-h-11 items-center break-words font-semibold text-ink";

export function UsersList({
  users,
  query,
  listPath = "/users",
  detailHref = (id: string) => `/users/${id}`,
}: {
  users: UserListRow[];
  query: string;
  listPath?: string;
  detailHref?: (id: string) => string;
}) {
  return (
    <div className="min-w-0">
      <form action={listPath} method="get" className="pc-form-row mb-4">
        <Input name="q" defaultValue={query} aria-label="Search users" placeholder="Search name or email" autoComplete="off" />
        <Button type="submit" className="w-full sm:w-auto">Search</Button>
      </form>
      {users.length === 0 ? (
        <p className="rounded-lg border border-line bg-white p-4 text-sm">{query ? "No users match that search." : "No users yet."}</p>
      ) : (
        <ul className="space-y-3">
          {users.map((user) => (
            <li key={user.id} className="min-w-0 rounded-lg border border-line bg-white p-3">
              <Link href={detailHref(user.id)} className={linkClass}>{user.email}</Link>
              <p className="text-sm text-muted">{user.name ?? "No name"} · {user.staffRole ?? "Not staff"} · {user.disabled ? "Disabled" : "Active"}</p>
              <p className="pc-break text-sm text-muted">{user.organizations || "No organizations"}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export type UserMembership = {
  id: string;
  organizationId: string;
  organizationName: string;
  roleId: string;
  roleName: string;
  status: "ACTIVE" | "INVITED" | "DISABLED";
  roles: { id: string; name: string }[];
};

export type UserPlacement = {
  organizationId: string;
  organizationName: string;
  roleId: string;
  roleName: string;
};

export function UserDetail({
  user,
  memberships,
  placements,
  canEdit,
  canStaff,
  self,
  actions,
  listHref = "/users",
}: {
  user: {
    id: string;
    email: string;
    name: string | null;
    disabled: boolean;
    staffManager: boolean;
    sessionCount: number;
    staff: { role: string; removed: boolean; totp: "enrolled" | "pending" } | null;
  };
  memberships: UserMembership[];
  placements: UserPlacement[];
  canEdit: boolean;
  canStaff: boolean;
  self: boolean;
  actions?: {
    saveProfile?: FormAction;
    savePassword?: FormAction;
    resetTotp?: FormAction;
    signOut?: FormAction;
    setAccess?: FormAction;
    changeRole?: FormAction;
    removeMember?: FormAction;
    addOrganization?: FormAction;
    saveStaff?: FormAction;
  };
  listHref?: string;
}) {
  const submit = (action: FormAction | undefined) => (action ? "submit" : "button") as "submit" | "button";
  return (
    <div className="min-w-0 space-y-4">
      <Link href={listHref} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent">Users</Link>
      <header>
        <h1 className="pc-break text-2xl font-semibold tracking-tight">{user.email}</h1>
        <p className="mt-1 text-sm text-muted">
          {user.name ?? "No name"} · {user.disabled ? "Disabled" : "Active"} · {user.sessionCount} {user.sessionCount === 1 ? "session" : "sessions"}
        </p>
      </header>
      <section className="space-y-4 rounded-lg border border-line bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Profile</h2>
        {canEdit ? (
          <form action={actions?.saveProfile} className="space-y-4">
            <input type="hidden" name="userId" value={user.id} />
            <div>
              <Label htmlFor="user-name">Name</Label>
              <Input id="user-name" name="name" defaultValue={user.name ?? ""} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="user-email">Email</Label>
              <Input id="user-email" name="email" type="email" required defaultValue={user.email} readOnly={user.staffManager} className="mt-1" />
              {user.staffManager ? <p className="mt-1 text-sm text-muted">This email stays on the staff manager account.</p> : null}
            </div>
            <Button type={submit(actions?.saveProfile)} className="w-full sm:w-auto">Save profile</Button>
          </form>
        ) : (
          <p className="text-sm text-muted">You can view this account. A super admin can edit it.</p>
        )}
      </section>
      {canEdit ? (
        <section className="space-y-4 rounded-lg border border-line bg-white p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Password</h2>
          <form action={actions?.savePassword} className="space-y-3">
            <input type="hidden" name="userId" value={user.id} />
            <Label htmlFor="user-password">New password</Label>
            <Input id="user-password" name="password" type="password" autoComplete="new-password" minLength={8} required />
            <Button type={submit(actions?.savePassword)} className="w-full sm:w-auto">Set password</Button>
          </form>
          <form action={actions?.savePassword}>
            <input type="hidden" name="userId" value={user.id} />
            <input type="hidden" name="clear" value="1" />
            <Button type={submit(actions?.savePassword)} variant="secondary" className="w-full sm:w-auto">Clear password</Button>
          </form>
        </section>
      ) : null}
      {canEdit ? (
        <section className="space-y-3 rounded-lg border border-line bg-white p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Access</h2>
          <p className="text-sm text-muted">
            Two-factor: {user.staff ? user.staff.totp : "not staff"}
          </p>
          {user.staff ? (
            <form action={actions?.resetTotp}>
              <input type="hidden" name="userId" value={user.id} />
              <Button type={submit(actions?.resetTotp)} variant="secondary" className="w-full sm:w-auto">Reset 2FA</Button>
            </form>
          ) : null}
          <form action={actions?.signOut}>
            <input type="hidden" name="userId" value={user.id} />
            <Button type={submit(actions?.signOut)} variant="secondary" className="w-full sm:w-auto">Sign out of all sessions</Button>
          </form>
          {self || user.staffManager ? (
            <p className="text-sm text-muted">{self ? "You cannot disable your own account." : "The staff manager account cannot be disabled."}</p>
          ) : (
            <form action={actions?.setAccess}>
              <input type="hidden" name="userId" value={user.id} />
              <input type="hidden" name="disabled" value={user.disabled ? "0" : "1"} />
              <Button type={submit(actions?.setAccess)} variant="danger" className="w-full sm:w-auto">
                {user.disabled ? "Re-enable" : "Disable account"}
              </Button>
            </form>
          )}
        </section>
      ) : null}
      <section className="rounded-lg border border-line bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Organizations</h2>
        {memberships.length === 0 ? <p className="mt-2 text-sm text-muted">No organization memberships.</p> : null}
        <ul className="mt-2">
          {memberships.map((membership) => (
            <li key={membership.id} className="min-w-0 border-t border-line py-3">
              <p className="break-words font-semibold">{membership.organizationName}</p>
              <p className="text-sm text-muted">{membership.roleName} · {membership.status === "ACTIVE" ? "Active" : membership.status === "INVITED" ? "Invited" : "Removed"}</p>
              {canEdit && membership.status !== "DISABLED" ? (
                <div className="mt-2 space-y-2">
                  <form action={actions?.changeRole} className="pc-form-row">
                    <input type="hidden" name="organizationId" value={membership.organizationId} />
                    <input type="hidden" name="membershipId" value={membership.id} />
                    <input type="hidden" name="next" value={`/users/${user.id}`} />
                    <select name="roleId" aria-label={`Role at ${membership.organizationName}`} className="pc-control w-full" defaultValue={membership.roleId}>
                      {membership.roles.map((role) => (
                        <option key={role.id} value={role.id}>{role.name}</option>
                      ))}
                    </select>
                    <Button type={submit(actions?.changeRole)} variant="secondary" className="w-full sm:w-auto">Save role</Button>
                  </form>
                  <form action={actions?.removeMember}>
                    <input type="hidden" name="organizationId" value={membership.organizationId} />
                    <input type="hidden" name="membershipId" value={membership.id} />
                    <input type="hidden" name="next" value={`/users/${user.id}`} />
                    <Button type={submit(actions?.removeMember)} variant="danger" className="w-full sm:w-auto">Remove</Button>
                  </form>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        {canEdit && placements.length > 0 ? (
          <form action={actions?.addOrganization} className="pc-form-row mt-4 border-t border-line pt-4">
            <input type="hidden" name="userId" value={user.id} />
            <select name="placement" aria-label="Organization and role" className="pc-control w-full" defaultValue={`${placements[0]?.organizationId}|${placements[0]?.roleId}`}>
              {placements.map((placement) => (
                <option key={`${placement.organizationId}-${placement.roleId}`} value={`${placement.organizationId}|${placement.roleId}`}>
                  {placement.organizationName} · {placement.roleName}
                </option>
              ))}
            </select>
            <Button type={submit(actions?.addOrganization)} className="w-full sm:w-auto">Add to organization</Button>
          </form>
        ) : null}
      </section>
      <section className="space-y-3 rounded-lg border border-line bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Staff</h2>
        <p className="text-sm text-muted">
          {user.staff && !user.staff.removed ? `${user.staff.role} · 2FA ${user.staff.totp}` : "Not staff"}
        </p>
        {canStaff && !self ? (
          <div className="space-y-3">
            <form action={actions?.saveStaff} className="pc-form-row">
              <input type="hidden" name="userId" value={user.id} />
              <select name="role" aria-label="Staff role" className="pc-control w-full" defaultValue={user.staff && !user.staff.removed ? user.staff.role : "SUPPORT"}>
                {PLATFORM_ROLES.map((role) => (
                  <option key={role}>{role}</option>
                ))}
              </select>
              <Button type={submit(actions?.saveStaff)} className="w-full sm:w-auto">Save staff</Button>
            </form>
            {user.staff && !user.staff.removed ? (
              <form action={actions?.saveStaff}>
                <input type="hidden" name="userId" value={user.id} />
                <input type="hidden" name="remove" value="1" />
                <Button type={submit(actions?.saveStaff)} variant="danger" className="w-full sm:w-auto">Remove staff</Button>
              </form>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted">
            {canStaff
              ? "You cannot change your own super admin access."
              : `Only ${PLATFORM_STAFF_MANAGER_EMAIL} can add, remove, or change staff roles.`}
          </p>
        )}
      </section>
    </div>
  );
}
