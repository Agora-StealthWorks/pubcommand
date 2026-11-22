import { defaultPlanChoice, organizationPublicUrl } from "@pubcommand/core";
import { Button, Input, Label } from "@pubcommand/ui";
import Link from "next/link";
import { OrgSlugField } from "./org-slug-field";

type FormAction = (formData: FormData) => void | Promise<void>;

export type OrganizationListItem = {
  id: string;
  name: string;
  slug: string;
  planId: string;
  planName: string;
  seatsUsed: number;
  seatLimit: number;
  brands: number;
  workspaces: number;
  suspended: boolean;
  deleted?: boolean;
};

const primaryLink =
  "inline-flex min-h-11 w-full items-center justify-center rounded-md border border-accent bg-accent px-4 text-sm font-semibold text-white sm:w-auto";
const secondaryLink =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink";

export function OrganizationsList({
  organizations,
  rootDomain,
  canCreate,
  newHref = "/orgs/new",
  detailHref = (id: string) => `/orgs/${id}`,
}: {
  organizations: OrganizationListItem[];
  rootDomain: string;
  canCreate: boolean;
  newHref?: string;
  detailHref?: (id: string) => string;
}) {
  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-semibold tracking-tight text-ink">Organizations</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Create an organization, then open it on its subdomain. Seats count active and invited members against the plan limit.
          </p>
        </div>
        {canCreate ? (
          <Link href={newHref} className={primaryLink}>
            New organization
          </Link>
        ) : null}
      </div>
      <div className="min-w-0 max-w-full rounded-lg border border-line bg-white">
        <table className="w-full table-fixed border-collapse text-sm" aria-label="Organizations">
          <thead className="text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th scope="col" className="w-[46%] px-3 py-2 font-semibold md:w-[34%]">Name</th>
              <th scope="col" className="w-[27%] px-2 py-2 font-semibold md:w-[18%]">Plan</th>
              <th scope="col" className="w-[27%] px-2 py-2 font-semibold md:w-[14%]">Seats</th>
              <th scope="col" className="hidden px-2 py-2 font-semibold md:table-cell md:w-[34%]">Usage</th>
            </tr>
          </thead>
          <tbody>
            {organizations.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center">
                  <p className="font-semibold text-ink">No organizations yet</p>
                  <p className="mx-auto mt-1 max-w-sm text-sm text-muted">Create one to give it a subdomain, a plan, and a first admin.</p>
                  {canCreate ? (
                    <Link href={newHref} className={`${primaryLink} mt-4`}>
                      Create
                    </Link>
                  ) : null}
                </td>
              </tr>
            ) : (
              organizations.map((organization) => {
                const publicUrl = organizationPublicUrl(organization.slug, rootDomain);
                const usage = `${organization.brands} brands · ${organization.workspaces} workspaces`;
                return (
                  <tr key={organization.id} className="border-t border-line align-top">
                    <td className="min-w-0 px-3 py-3">
                      <Link href={detailHref(organization.id)} className="flex min-h-11 min-w-0 items-center break-words font-semibold text-ink">
                        {organization.name}
                      </Link>
                      {organization.deleted ? (
                        <p className="text-xs font-semibold text-[#b42318]">Deleted</p>
                      ) : organization.suspended ? (
                        <p className="text-xs font-semibold text-[#b42318]">Suspended</p>
                      ) : null}
                      <a href={publicUrl} className="pc-break block text-xs text-accent">
                        {publicUrl}
                      </a>
                      <p className="mt-1 text-xs text-muted md:hidden">{usage}</p>
                      <a href={publicUrl} className={`${secondaryLink} mt-2 w-full sm:w-auto`}>
                        Open org
                      </a>
                    </td>
                    <td className="break-words px-2 py-3">{organization.planName}</td>
                    <td className="px-2 py-3">{organization.seatsUsed}/{organization.seatLimit}</td>
                    <td className="hidden break-words px-2 py-3 md:table-cell">{usage}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function NewOrganizationForm({
  action,
  plans,
  rootDomain,
  listHref = "/orgs",
  plansHref = "/plans",
}: {
  action?: FormAction;
  plans: { id: string; name: string; key?: string }[];
  rootDomain: string;
  listHref?: string;
  plansHref?: string;
}) {
  const keyed = plans.flatMap((plan) => (plan.key ? [{ id: plan.id, key: plan.key }] : []));
  const selectedId = defaultPlanChoice(keyed)?.id ?? plans[0]?.id ?? "";
  return (
    <div className="mx-auto w-full max-w-lg">
      <Link href={listHref} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent">
        Organizations
      </Link>
      <h1 className="break-words text-2xl font-semibold tracking-tight text-ink">New organization</h1>
      <p className="mt-1 text-sm text-muted">
        The subdomain is lowercase and must be unique. Reserved names such as admin, app, www, and api are blocked.
      </p>
      {plans.length === 0 ? (
        <div className="mt-6 rounded-lg border border-line bg-white p-4">
          <p className="text-sm">No plans exist yet. Create one, then come back to this form.</p>
          <Link href={plansHref} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent">
            Create a plan
          </Link>
        </div>
      ) : (
        <form action={action} className="mt-6 space-y-4 rounded-lg border border-line bg-white p-4">
          <div>
            <Label htmlFor="org-name">Organization name</Label>
            <Input id="org-name" name="name" required autoComplete="organization" className="mt-1" />
          </div>
          <OrgSlugField rootDomain={rootDomain} />
          <div>
            <Label htmlFor="org-plan">Plan</Label>
            <select id="org-plan" name="planId" required className="pc-control mt-1 w-full" defaultValue={selectedId}>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="org-admin-email">First admin email</Label>
            <Input id="org-admin-email" name="adminEmail" type="email" required autoComplete="email" className="mt-1" />
          </div>
          <Button type={action ? "submit" : "button"} className="w-full">
            Create organization
          </Button>
        </form>
      )}
    </div>
  );
}

export type OrganizationMemberRow = {
  id: string;
  email: string;
  roleId: string;
  roleName: string;
  status: "ACTIVE" | "INVITED" | "DISABLED";
};

function statusLabel(status: OrganizationMemberRow["status"]) {
  if (status === "ACTIVE") return "Active";
  if (status === "INVITED") return "Invited";
  return "Removed";
}

export function OrganizationDetail({
  organization,
  plans,
  roles,
  members,
  rootDomain,
  selfIsAdmin,
  canManage,
  canPlan,
  canSuspend,
  canImpersonate,
  listHref = "/orgs",
  workspace,
  actions,
  children,
}: {
  organization: OrganizationListItem;
  plans: { id: string; name: string }[];
  roles: { id: string; name: string }[];
  members: OrganizationMemberRow[];
  rootDomain: string;
  selfIsAdmin: boolean;
  canManage: boolean;
  canPlan: boolean;
  canSuspend: boolean;
  canImpersonate: boolean;
  listHref?: string;
  /**
   * "Open workspace" for the staff member looking at this page. `member`: they belong to it.
   * `super_admin`: the platform super admin may open any organization. `none`: they must add
   * themselves as admin or view as a member first (nothing is granted from this link).
   */
  workspace?: { href: string; access: "member" | "super_admin" | "none" };
  children?: React.ReactNode;
  actions?: {
    addMember?: FormAction;
    removeMember?: FormAction;
    changeRole?: FormAction;
    addSelf?: FormAction;
    changePlan?: FormAction;
    suspend?: FormAction;
    impersonate?: FormAction;
  };
}) {
  const publicUrl = organizationPublicUrl(organization.slug, rootDomain);
  const detailPath = `/orgs/${organization.id}`;
  return (
    <div className="space-y-4">
      <Link href={listHref} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent">
        Organizations
      </Link>
      <header>
        <h1 className="break-words text-2xl font-semibold tracking-tight text-ink">{organization.name}</h1>
        <p className="mt-1 text-sm text-muted">
          {organization.deleted ? "Deleted. " : organization.suspended ? "Suspended. " : ""}
          {organization.seatsUsed}/{organization.seatLimit} seats · {organization.brands} brands · {organization.workspaces} workspaces
        </p>
      </header>
      <section className="rounded-lg border border-line bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Subdomain</h2>
        <a href={publicUrl} className="pc-break mt-2 block text-sm font-semibold text-accent">
          {publicUrl}
        </a>
        {workspace && workspace.access !== "none" && !organization.deleted ? (
          <div className="mt-3">
            <a href={workspace.href} className={primaryLink} data-testid="open-workspace">
              Open workspace
            </a>
            <p className="mt-2 text-xs text-muted">
              {workspace.access === "member" ? "You are a member. Use the switcher at the top of the sidebar to come back here." : "You are not a member. As super admin you can still open any organization."}
            </p>
          </div>
        ) : workspace && !organization.deleted ? (
          <p className="mt-3 text-sm text-muted" data-testid="open-workspace-none">
            You are not a member, so you cannot open its workspace yet.{" "}
            {canManage ? (
              <>
                <a href="#members" className="font-semibold text-accent">Add yourself as admin</a>
                {canImpersonate ? " or " : "."}
              </>
            ) : null}
            {canImpersonate ? (
              <>
                <a href="#impersonate" className="font-semibold text-accent">view it as a member</a>.
              </>
            ) : null}
            {!canManage && !canImpersonate ? "Ask a super admin to add you." : null}
          </p>
        ) : (
          <a href={publicUrl} className={`${secondaryLink} mt-3 w-full sm:w-auto`}>
            Open org
          </a>
        )}
      </section>
      <section className="rounded-lg border border-line bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Plan</h2>
        <p className="mt-2 font-semibold">{organization.planName}</p>
        {canPlan && plans.length > 0 ? (
          <form action={actions?.changePlan} className="pc-form-row mt-3">
            <input type="hidden" name="organizationId" value={organization.id} />
            <select name="planId" aria-label="Plan" className="pc-control w-full" defaultValue={organization.planId}>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                </option>
              ))}
            </select>
            <Button type={actions?.changePlan ? "submit" : "button"} className="w-full sm:w-auto">
              Change plan
            </Button>
          </form>
        ) : null}
      </section>
      <section id="members" className="scroll-mt-4 rounded-lg border border-line bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Members</h2>
        {members.length === 0 ? <p className="mt-2 text-sm text-muted">No members yet.</p> : null}
        <ul className="mt-2">
          {members.map((member) => (
            <li key={member.id} className="flex flex-col gap-2 border-t border-line py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="pc-break font-semibold">{member.email}</p>
                <p className="text-sm text-muted">{member.roleName} · {statusLabel(member.status)}</p>
              </div>
              {canManage && member.status !== "DISABLED" ? (
                <div className="flex w-full min-w-0 flex-col gap-2">
                  <form action={actions?.changeRole} className="pc-form-row">
                    <input type="hidden" name="organizationId" value={organization.id} />
                    <input type="hidden" name="membershipId" value={member.id} />
                    <select name="roleId" aria-label={`Role for ${member.email}`} className="pc-control w-full" defaultValue={member.roleId}>
                      {roles.map((role) => (
                        <option key={role.id} value={role.id}>{role.name}</option>
                      ))}
                    </select>
                    <Button type={actions?.changeRole ? "submit" : "button"} variant="secondary" className="w-full sm:w-auto">
                      Save role
                    </Button>
                  </form>
                  <form action={actions?.removeMember}>
                    <input type="hidden" name="organizationId" value={organization.id} />
                    <input type="hidden" name="membershipId" value={member.id} />
                    <Button type={actions?.removeMember ? "submit" : "button"} variant="danger" className="w-full sm:w-auto">
                      Remove
                    </Button>
                  </form>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        {canManage ? (
          <div className="mt-4 space-y-4 border-t border-line pt-4">
            {roles.length > 0 ? (
              <form action={actions?.addMember} className="pc-form-row">
                <input type="hidden" name="organizationId" value={organization.id} />
                <Input name="email" type="email" required placeholder="person@example.com" aria-label="Member email" />
                <select name="roleId" aria-label="Role" className="pc-control w-full" defaultValue={roles[0]?.id}>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
                <Button type={actions?.addMember ? "submit" : "button"} className="w-full sm:w-auto">
                  Add member
                </Button>
              </form>
            ) : null}
            {selfIsAdmin ? (
              <p className="text-sm text-muted">You already administer this organization.</p>
            ) : (
              <form action={actions?.addSelf}>
                <input type="hidden" name="organizationId" value={organization.id} />
                <Button type={actions?.addSelf ? "submit" : "button"} variant="secondary" className="w-full sm:w-auto">
                  Add me as admin
                </Button>
              </form>
            )}
          </div>
        ) : null}
      </section>
      {canSuspend && !organization.deleted ? (
        <section className="rounded-lg border border-line bg-white p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Access</h2>
          <p className="mt-2 text-sm text-muted">
            {organization.suspended ? "Members cannot open this organization while it is suspended." : "Suspending blocks every member until you reactivate it."}
          </p>
          <form action={actions?.suspend} className="mt-3">
            <input type="hidden" name="organizationId" value={organization.id} />
            <input type="hidden" name="suspend" value={organization.suspended ? "0" : "1"} />
            <input type="hidden" name="next" value={detailPath} />
            <Button type={actions?.suspend ? "submit" : "button"} variant="danger" className="w-full sm:w-auto">
              {organization.suspended ? "Reactivate" : "Suspend"}
            </Button>
          </form>
        </section>
      ) : null}
      {children}
      {canImpersonate && !organization.deleted ? (
        <section id="impersonate" className="scroll-mt-4 rounded-lg border border-line bg-white p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Impersonate</h2>
          <form action={actions?.impersonate} className="pc-form-row mt-3">
            <input type="hidden" name="organizationId" value={organization.id} />
            <Input name="email" type="email" required placeholder="member@example.com" aria-label="Member email to impersonate" />
            <Button type={actions?.impersonate ? "submit" : "button"} className="w-full sm:w-auto">
              Impersonate
            </Button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
