import { AGENT_PLATFORMS, agentPlatformLabel, defaultAgentName, platformFromClientName } from "@pubcommand/core";
import { rawPrisma, tenantDb } from "@pubcommand/db";
import { Button, Input, Label } from "@pubcommand/ui";
import { notFound, redirect } from "next/navigation";
import { approveConnection, denyConnection } from "@/features/agents/actions";
import { checkAuthorizeRequest } from "@/features/agents/oauth";
import { agentsPage } from "@/features/agents/page-access";

/**
 * OAuth authorization screen for MCP connectors (Claude, ChatGPT, …). The org layout has
 * already sent anonymous visitors to sign in and back here. The person approves the app
 * as one of their agents in this organization.
 */
export default async function ConnectAgentPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await agentsPage(slug);
  if (!access) notFound();
  const checked = await checkAuthorizeRequest(query);
  if (!checked.ok) {
    if ("redirect" in checked) redirect(checked.redirect);
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-line bg-white p-6">
        <h1 className="text-xl font-semibold">Cannot connect</h1>
        <p className="mt-2 text-sm text-muted">{checked.show}</p>
      </div>
    );
  }
  const { request } = checked;
  const { ctx, me } = access;
  const user = await rawPrisma().user.findUnique({ where: { id: me }, select: { name: true, email: true } });
  const guessed = platformFromClientName(request.clientName);
  const mine = await tenantDb(ctx.resolved.id).aiAgent.findMany({ where: { ownerUserId: me, removedAt: null }, orderBy: { createdAt: "asc" } });
  const role = (await tenantDb(ctx.resolved.id).membership.findFirst({ where: { userId: me }, include: { role: true } }))?.role.name ?? "your role";
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
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Connect an AI agent</p>
        <h1 className="mt-1 text-xl font-semibold">
          {request.clientName} wants to work in {ctx.resolved.name}
        </h1>
        <p className="mt-2 text-sm text-muted">
          It will act as your agent, with the same access you have ({role}), in {ctx.resolved.name} only. Its AI usage stays on your {agentPlatformLabel(guessed === "other" ? "other" : guessed)} account. You can
          pause, narrow or remove it any time in AI Agents.
        </p>
        <form action={approveConnection} className="mt-5 space-y-4">
          {hidden}
          {mine.length ? (
            <div>
              <Label htmlFor="connect-agent">Agent</Label>
              <select id="connect-agent" name="agentId" defaultValue="new" className="pc-control mt-1 w-full">
                <option value="new">A new agent</option>
                {mine.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} ({agentPlatformLabel(agent.platform)})
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted">Pick an existing agent to reconnect it; name and platform below are for a new one.</p>
            </div>
          ) : (
            <input type="hidden" name="agentId" value="new" />
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="connect-name">Name</Label>
              <Input id="connect-name" name="name" maxLength={80} defaultValue={defaultAgentName(user?.name, user?.email ?? "", guessed)} className="mt-1" />
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
          <div className="flex flex-wrap gap-2">
            <Button type="submit">Approve</Button>
          </div>
        </form>
        <form action={denyConnection} className="mt-2">
          {hidden}
          <Button type="submit" variant="ghost">
            Cancel
          </Button>
        </form>
      </div>
      <p className="text-center text-xs text-muted">
        Signed in as {user?.email}. Returning to {new URL(request.redirectUri).host}.
      </p>
    </div>
  );
}
