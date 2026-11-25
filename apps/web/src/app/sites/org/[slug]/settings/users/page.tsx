import { buildSiteUrl, can, defaultMemberRoleId } from "@pubcommand/core";
import { agentLabels } from "@/features/agents/data";
import Link from "next/link";
import { Button, Input } from "@pubcommand/ui";
import { moduleRegistry } from "@pubcommand/modules";
import { tenantDb } from "@pubcommand/db";
import { notFound } from "next/navigation";
import { TableScroll } from "@/components/table-scroll";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { getOrgContext } from "@/lib/org";
import { addExclusion, inviteUser, setRegistration } from "@/server/org-actions";
import { rootDomain } from "@/lib/auth";

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
  const [memberships, roles, settings] = await Promise.all([
    tenantDb(ctx.resolved.id).membership.findMany({ include: { user: true, role: true }, orderBy: { createdAt: "asc" } }),
    tenantDb(ctx.resolved.id).role.findMany({ orderBy: { name: "asc" } }),
    tenantDb(ctx.resolved.id).orgSettings.findFirst({ select: { registrationEnabled: true } }),
  ]);
  const registrationOpen = Boolean(settings?.registrationEnabled);
  const registerUrl = buildSiteUrl({ rootDomain: rootDomain(), requestHost: ctx.request.host, site: { kind: "org", slug: ctx.resolved.slug }, pathname: "/register" });
  const permissions = moduleRegistry.all().flatMap((manifest) => manifest.permissions);
  // AI agents are members too (role, app access, exclusions); they are labelled here and managed in AI Agents.
  const agents = await agentLabels(ctx.resolved.id);
  return (
    <div>
      <PageHeader title="Users" description="Invites send a sign-in link; the first time they use it, they set their own password. New people start as User (read-only) unless you pick another role. Open someone to change their role, app access or password." />
      <Flash error={query.error} notice={query.notice} />
      <form action={inviteUser} className="pc-form-row mb-6">
        <Input name="email" type="email" required placeholder="person@example.com" className="md:max-w-xs" />
        <select name="roleId" aria-label="Role" defaultValue={defaultMemberRoleId(roles) ?? undefined} className="pc-control w-full md:w-auto">
          {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
        </select>
        <Button type="submit" className="w-full md:w-auto">Invite</Button>
      </form>
      <section className="mb-6 rounded-xl border border-line bg-white p-4" aria-labelledby="registration-h">
        <h2 id="registration-h" className="text-sm font-semibold">
          Registration page {registrationOpen ? <span className="ml-1 rounded-full bg-[#ecfdf3] px-2 py-0.5 text-xs font-semibold text-[#067647]">Open</span> : <span className="ml-1 rounded-full bg-canvas px-2 py-0.5 text-xs font-semibold text-muted">Closed</span>}
        </h2>
        <p className="mt-1 text-sm text-muted">
          A public sign-up page on your subdomain. Anyone with the link can create an account and join as <b className="text-ink">User</b> (read-only), up to your seat limit. Change their role here afterwards.
        </p>
        <p className="pc-break mt-2 text-sm">
          <a href={registerUrl} className="font-mono text-accent hover:underline" target="_blank" rel="noreferrer">
            {registerUrl}
          </a>
        </p>
        <form action={setRegistration} className="mt-3">
          <input type="hidden" name="enabled" value={registrationOpen ? "0" : "1"} />
          <Button type="submit" variant={registrationOpen ? "secondary" : "primary"} className="w-full sm:w-auto">
            {registrationOpen ? "Close registration page" : "Open registration page"}
          </Button>
        </form>
      </section>
      <TableScroll>
      <table className="w-full min-w-[40rem] border-collapse text-sm">
        <thead className="bg-canvas text-left text-xs uppercase tracking-wide text-muted">
          <tr><th className="px-3 py-2">Email</th><th>Role</th><th>Status</th><th>Exclusion</th></tr>
        </thead>
        <tbody>
          {memberships.map((membership) => (
            <tr key={membership.id} className="border-t border-line">
              <td className="pc-break px-3 py-2">
                <Link href={`/settings/users/${membership.userId}`} className="inline-flex min-h-11 items-center font-semibold text-accent">
                  {agents.get(membership.userId)?.name ?? membership.user.email}
                </Link>
                {agents.has(membership.userId) ? (
                  <span className="ml-2 inline-flex items-center rounded-full bg-[#dbe7ff] px-2 py-0.5 text-xs font-semibold text-[#1e3a8a]">
                    AI agent · {agents.get(membership.userId)!.platformLabel} · {agents.get(membership.userId)!.ownerName}
                  </span>
                ) : null}
              </td>
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
