import {
  adjustableModule,
  can,
  classifyPermissions,
  effectiveAppLevel,
  memberPasswordBlocked,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  type MemberAppChoice,
  type MemberAppLevel,
} from "@pubcommand/core";
import { loadAccessSubject, memberPasswordFacts, tenantDb } from "@pubcommand/db";
import { moduleRegistry } from "@pubcommand/modules";
import { Button, Input, Label } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { appCatalog } from "@/lib/apps";
import { getOrgContext } from "@/lib/org";
import { agentLabels } from "@/features/agents/data";
import { changeMemberRole, setMemberAppAccess, setMemberPasswordAction } from "@/server/org-actions";

const LEVEL_LABEL: Record<MemberAppLevel, string> = { NONE: "No access", VIEW: "View", EDIT: "Edit" };
const LEVEL_TONE: Record<MemberAppLevel, string> = {
  NONE: "bg-canvas text-muted",
  VIEW: "bg-[#eff8ff] text-[#175cd3]",
  EDIT: "bg-[#ecfdf3] text-[#067647]",
};

export default async function MemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; userId: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { slug, userId } = await params;
  const query = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(userId)) notFound();
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") notFound();
  if (!can(ctx.subject, "settings.users.manage", ctx.scope)) return <Denied />;
  const db = tenantDb(ctx.resolved.id);
  const member = await db.membership.findFirst({ where: { userId }, include: { user: true, role: { include: { grants: true } } } });
  if (!member) notFound();
  const [roles, overrides] = await Promise.all([
    db.role.findMany({ orderBy: { name: "asc" } }),
    db.memberAppAccess.findMany({ where: { userId } }),
  ]);
  const classified = classifyPermissions(moduleRegistry.all());
  const target = member.status === "ACTIVE" ? await loadAccessSubject(ctx.resolved.id, userId, moduleRegistry.permissionModules()) : null;
  const scope = { organizationId: ctx.resolved.id, brandId: member.brandId ?? ctx.scope.brandId ?? null };
  const roleAllows = new Set(member.role.grants.filter((grant) => grant.effect === "ALLOW").map((grant) => grant.permission));
  const roleDenies = new Set(member.role.grants.filter((grant) => grant.effect === "DENY").map((grant) => grant.permission));
  const self = userId === ctx.effectiveUserId;
  const apps = appCatalog().filter((app) => ctx.subject.entitledModuleIds.includes(app.moduleId) && adjustableModule(app.moduleId, classified));
  const passwordBlocked = memberPasswordBlocked({
    actorUserId: ctx.auth.user.id,
    targetUserId: userId,
    actorCanManageUsers: true,
    impersonating: Boolean(ctx.impersonatingHere),
    ...(await memberPasswordFacts(ctx.resolved.id, userId)),
  });
  const agent = (await agentLabels(ctx.resolved.id)).get(userId);
  const choiceFor = (moduleId: string): MemberAppChoice => overrides.find((row) => row.moduleId === moduleId)?.level ?? "ROLE";
  return (
    <div className="max-w-3xl space-y-4">
      <Link href="/settings/users" className="inline-flex min-h-11 items-center text-sm font-semibold text-accent">
        Users
      </Link>
      <PageHeader
        title={member.user.name || member.user.email}
        description={agent ? `AI agent (${agent.platformLabel}) belonging to ${agent.ownerName}. It starts with its owner's access; narrow it here like anyone's.` : member.user.email}
      />
      <Flash error={query.error} notice={query.notice} />
      <section className="rounded-xl border border-line bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Role</h2>
        <p className="mt-2 text-sm">
          <span className="font-semibold">{member.role.name}</span> · {member.status === "ACTIVE" ? "Active" : member.status === "INVITED" ? "Invited" : "Removed"}
        </p>
        {member.role.description ? <p className="mt-1 text-sm text-muted">{member.role.description}</p> : null}
        {self ? (
          <p className="mt-3 text-sm text-muted">You cannot change your own role or app access.</p>
        ) : (
          <form action={changeMemberRole} className="pc-form-row mt-3">
            <input type="hidden" name="userId" value={userId} />
            <select name="roleId" aria-label="Role" defaultValue={member.roleId} className="pc-control w-full sm:w-64">
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
            <Button type="submit" variant="secondary" className="w-full sm:w-auto">
              Change role
            </Button>
          </form>
        )}
      </section>
      {agent ? (
      <section className="rounded-xl border border-line bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">AI agent</h2>
        <p className="mt-2 text-sm">
          It signs in with its own connection, never a password.{" "}
          <Link href={`/agents/${agent.agentId}`} className="font-semibold text-accent">
            Open it in AI Agents
          </Link>
        </p>
      </section>
      ) : (
      <section className="rounded-xl border border-line bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Password</h2>
        <p className="mt-2 text-sm">{member.user.passwordHash ? "They have a password." : "They have no password yet, so they cannot log in with one."}</p>
        {passwordBlocked ? (
          <p className="mt-2 text-sm text-muted">
            {passwordBlocked}
            {userId === ctx.auth.user.id ? (
              <>
                {" "}
                <Link href="/account" className="font-semibold text-accent">
                  Open Your account
                </Link>
              </>
            ) : null}
          </p>
        ) : (
          <form action={setMemberPasswordAction} className="mt-3 space-y-3">
            <input type="hidden" name="userId" value={userId} />
            <input type="email" name="username" autoComplete="off" defaultValue={member.user.email} hidden readOnly />
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="member-new-password">New password</Label>
                <Input id="member-new-password" name="newPassword" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} required className="mt-1" />
              </div>
              <div>
                <Label htmlFor="member-confirm-password">Confirm new password</Label>
                <Input id="member-confirm-password" name="confirmPassword" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} required className="mt-1" />
              </div>
            </div>
            <p className="rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
              Setting a password signs {member.user.name || "them"} out everywhere. Tell them the new password privately, and ask them to change it in Your account.
            </p>
            <Button type="submit" variant="secondary" className="w-full sm:w-auto">
              Set password
            </Button>
          </form>
        )}
      </section>
      )}
      <section className="rounded-xl border border-line bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">App access</h2>
        <p className="mt-2 text-sm text-muted">
          Each app follows the role unless you set it here. View lets them look; Edit also lets them add and change things.
          {member.status !== "ACTIVE" ? " Effective access shows once they accept the invite." : ""}
        </p>
        <ul className="mt-3 divide-y divide-line">
          {apps.map((app) => {
            const roleLevel = effectiveAppLevel(app.moduleId, (permission) => roleAllows.has(permission) && !roleDenies.has(permission), classified);
            const effective = target ? effectiveAppLevel(app.moduleId, (permission) => can(target, permission, scope), classified) : null;
            const choice = choiceFor(app.moduleId);
            return (
              <li key={app.moduleId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="text-xl" aria-hidden>
                    {app.icon}
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold">{app.name}</p>
                    <p className="text-xs text-muted">
                      Role gives: {LEVEL_LABEL[roleLevel]}
                      {effective ? (
                        <>
                          {" · Now: "}
                          <span className={`rounded-full px-2 py-0.5 font-semibold ${LEVEL_TONE[effective]}`}>{LEVEL_LABEL[effective]}</span>
                        </>
                      ) : null}
                    </p>
                  </div>
                </div>
                {self ? null : (
                  <form action={setMemberAppAccess} className="pc-form-row sm:w-auto">
                    <input type="hidden" name="userId" value={userId} />
                    <input type="hidden" name="moduleId" value={app.moduleId} />
                    <select name="level" aria-label={`Access to ${app.name}`} defaultValue={choice} className="pc-control w-full sm:w-44">
                      <option value="ROLE">Role default</option>
                      <option value="NONE">No access</option>
                      <option value="VIEW">View</option>
                      <option value="EDIT">Edit</option>
                    </select>
                    <Button type="submit" variant="secondary" className="w-full sm:w-auto">
                      Save
                    </Button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
