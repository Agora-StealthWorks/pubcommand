import { AGENT_PLATFORMS, agentPlatformLabel, buildSiteUrl, defaultAgentName, isAgentEmail, platformFromClientName } from "@pubcommand/core";
import { platformTx, rawPrisma } from "@pubcommand/db";
import { Button, Input, Label } from "@pubcommand/ui";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/brand";
import { approveAppConnection, denyAppConnection } from "@/features/agents/app-actions";
import { checkAuthorizeRequest } from "@/features/agents/oauth";
import { readSession, rootDomain } from "@/lib/auth";
import { CONSOLE_ORG_SLUG } from "@/lib/console-workspace";
import { currentRequest } from "@/lib/request";

export const dynamic = "force-dynamic";

/**
 * Log in to PubCommand from GrokBot (or any MCP app) at the one address for every organization,
 * app.<root>/api/mcp. The person logs in, picks the organization, and approves.
 */
export default async function ConnectFromAppPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const query = await searchParams;
  const request = await currentRequest();
  const auth = await readSession();
  if (!auth.user || isAgentEmail(auth.user.email)) {
    const here = `${request.origin}${request.pathname}${request.search}`;
    redirect(buildSiteUrl({ rootDomain: rootDomain(), requestHost: request.host, site: { kind: "marketing" }, pathname: "/login", search: `?next=${encodeURIComponent(here)}` }));
  }
  const checked = await checkAuthorizeRequest(query);
  if (!checked.ok) {
    if ("redirect" in checked) redirect(checked.redirect);
    return (
      <main className="mx-auto max-w-lg px-4 py-16">
        <h1 className="text-xl font-semibold">Cannot connect</h1>
        <p className="mt-2 text-sm text-muted">{checked.show}</p>
      </main>
    );
  }
  const oauth = checked.request;
  const guessed = platformFromClientName(oauth.clientName);
  const appName = guessed === "other" ? oauth.clientName : agentPlatformLabel(guessed);
  const user = await rawPrisma().user.findUnique({ where: { id: auth.user.id }, select: { name: true, email: true } });
  const memberships = await rawPrisma().membership.findMany({
    where: { userId: auth.user.id, status: "ACTIVE", organization: { deletedAt: null, suspendedAt: null, NOT: { slug: CONSOLE_ORG_SLUG } } },
    include: { organization: { select: { id: true, name: true } }, role: { select: { name: true } } },
    orderBy: { organization: { name: "asc" } },
  });
  const mine = memberships.length
    ? await platformTx((tx) => tx.aiAgent.findMany({ where: { ownerUserId: auth.user!.id, scope: "organization", removedAt: null, organizationId: { in: memberships.map((m) => m.organizationId) } }, orderBy: { createdAt: "asc" } }))
    : [];
  const orgName = new Map(memberships.map((m) => [m.organizationId, m.organization.name]));
  const hidden = (
    <>
      <input type="hidden" name="client_id" value={oauth.clientId} />
      <input type="hidden" name="redirect_uri" value={oauth.redirectUri} />
      <input type="hidden" name="state" value={oauth.state ?? ""} />
      <input type="hidden" name="code_challenge" value={oauth.codeChallenge} />
      <input type="hidden" name="code_challenge_method" value="S256" />
      <input type="hidden" name="response_type" value="code" />
    </>
  );

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-12">
      <BrandLogo className="h-8 w-auto" />
      <div className="mt-6 rounded-xl border border-line bg-white p-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Connect {appName}</p>
        <h1 className="mt-1 text-xl font-semibold">{appName} wants to work in PubCommand</h1>
        {query.error ? <p className="mt-3 rounded-md border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm text-[#912018]">{query.error}</p> : null}
        {memberships.length === 0 ? (
          <p className="mt-3 text-sm text-muted">You are not a member of any organization yet. Ask your admin for an invite, then connect again.</p>
        ) : (
          <form action={approveAppConnection} className="mt-5 space-y-4">
            {hidden}
            <div>
              <Label htmlFor="connect-org">Organization</Label>
              <select id="connect-org" name="organizationId" defaultValue={memberships[0]!.organizationId} className="pc-control mt-1 w-full">
                {memberships.map((m) => (
                  <option key={m.organizationId} value={m.organizationId}>
                    {m.organization.name} ({m.role.name})
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted">It works in this organization only, with the same access you have there.</p>
            </div>
            {mine.length ? (
              <div>
                <Label htmlFor="connect-agent">Agent</Label>
                <select id="connect-agent" name="agentId" defaultValue="new" className="pc-control mt-1 w-full">
                  <option value="new">A new agent</option>
                  {mine.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name} ({agentPlatformLabel(agent.platform)}, {orgName.get(agent.organizationId)})
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted">Reconnecting an existing agent keeps its history; it stays in its own organization.</p>
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
            <Button type="submit">Approve</Button>
          </form>
        )}
        <form action={denyAppConnection} className="mt-2">
          {hidden}
          <Button type="submit" variant="ghost">
            Cancel
          </Button>
        </form>
      </div>
      <p className="mt-3 text-center text-xs text-muted">Logged in as {user?.email}. Its AI usage stays on your own account.</p>
    </main>
  );
}
