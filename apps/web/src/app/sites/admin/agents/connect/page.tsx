import { AGENT_PLATFORMS, agentPlatformLabel, defaultAgentName, platformFromClientName } from "@pubcommand/core";
import { rawPrisma, tenantDb } from "@pubcommand/db";
import { Button, Input, Label } from "@pubcommand/ui";
import { redirect } from "next/navigation";
import { Denied } from "@/components/ui";
import { checkAuthorizeRequest } from "@/features/agents/oauth";
import { superAdminCtx } from "@/features/agents/platform-access";
import { approvePlatformConnection, denyPlatformConnection } from "@/features/agents/platform-actions";

/** OAuth authorization screen for platform agents (admin host). Super admins only. */
export default async function ConnectPlatformAgentPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const query = await searchParams;
  const ctx = await superAdminCtx();
  if (!ctx) return <Denied title="Only super admins can connect platform AI agents" />;
  const checked = await checkAuthorizeRequest(query);
  if (!checked.ok) {
    if ("redirect" in checked) redirect(checked.redirect);
    return <Denied title={checked.show} />;
  }
  const { request } = checked;
  const guessed = platformFromClientName(request.clientName);
  const me = await rawPrisma().user.findUnique({ where: { id: ctx.userId }, select: { name: true } });
  const mine = await tenantDb(ctx.consoleOrganizationId).aiAgent.findMany({ where: { scope: "platform", ownerUserId: ctx.userId, removedAt: null }, orderBy: { createdAt: "asc" } });
  const hidden = (
    <>
      <input type="hidden" name="client_id" value={request.clientId} />
      <input type="hidden" name="redirect_uri" value={request.redirectUri} />
      <input type="hidden" name="state" value={request.state ?? ""} />
      <input type="hidden" name="code_challenge" value={request.codeChallenge} />
      <input type="hidden" name="code_challenge_method" value="S256" />
      <input type="hidden" name="response_type" value="code" />
    </>
  );
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="rounded-xl border border-line bg-white p-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Connect a platform AI agent</p>
        <h1 className="mt-1 text-xl font-semibold">{request.clientName} wants platform access</h1>
        <p className="mt-2 text-sm text-muted">
          It will be your platform agent: the Master Brain, every organization&apos;s Brain, platform monitoring, and, if you allow it below, audited admin changes. Its AI usage stays on your own account.
        </p>
        <form action={approvePlatformConnection} className="mt-5 space-y-4">
          {hidden}
          {mine.length ? (
            <div>
              <Label htmlFor="connect-agent">Agent</Label>
              <select id="connect-agent" name="agentId" defaultValue="new" className="pc-control mt-1 w-full">
                <option value="new">A new platform agent</option>
                {mine.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} ({agentPlatformLabel(agent.platform)})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <input type="hidden" name="agentId" value="new" />
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="connect-name">Name</Label>
              <Input id="connect-name" name="name" maxLength={80} defaultValue={`${defaultAgentName(me?.name, ctx.email, guessed)} (Platform)`} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="connect-platform">AI platform</Label>
              <select id="connect-platform" name="platform" defaultValue={guessed} className="pc-control mt-1 w-full">
                {AGENT_PLATFORMS.map((platform) => (
                  <option key={platform.id} value={platform.id}>
                    {platform.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="allowAdminActions" defaultChecked className="mt-1 h-4 w-4" />
            <span>
              <span className="font-semibold">Can make admin changes</span>
              <span className="block text-muted">For a new agent. Suspend or resume organizations, change plans and app access, invite people, run jobs; each needs a reason and is audited.</span>
            </span>
          </label>
          <Button type="submit">Approve</Button>
        </form>
        <form action={denyPlatformConnection} className="mt-2">
          {hidden}
          <Button type="submit" variant="ghost">
            Cancel
          </Button>
        </form>
      </div>
      <p className="text-center text-xs text-muted">
        Signed in as {ctx.email}. Returning to {new URL(request.redirectUri).host}.
      </p>
    </div>
  );
}
