import { AGENT_PLATFORMS, agentPlatformLabel, isAgentEmail } from "@pubcommand/core";
import { rawPrisma, tenantDb } from "@pubcommand/db";
import { Badge } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TableScroll } from "@/components/table-scroll";
import { Flash } from "@/components/ui";
import { createAgentWithKey } from "@/features/agents/actions";
import { AgentKeyForm } from "@/features/agents/key-form";
import { agentsPage, when } from "@/features/agents/page-access";

export default async function AgentsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await agentsPage(slug);
  if (!access) notFound();
  const { ctx, canManage, me } = access;
  const db = tenantDb(ctx.resolved.id);
  const agents = await db.aiAgent.findMany({ where: { removedAt: null, ...(canManage ? {} : { ownerUserId: me }) }, orderBy: [{ createdAt: "asc" }] });
  const memberships = await db.membership.findMany({ where: { userId: { in: agents.map((agent) => agent.userId) } }, include: { role: true } });
  const roleOf = new Map(memberships.map((membership) => [membership.userId, membership.role.name]));
  const owners = await rawPrisma().user.findMany({ where: { id: { in: [...new Set(agents.map((agent) => agent.ownerUserId))] } }, select: { id: true, name: true, email: true } });
  const ownerName = new Map(owners.map((owner) => [owner.id, owner.name || owner.email]));
  const day = new Date(Date.now() - 86_400_000);
  const counts = await Promise.all(agents.map((agent) => db.aiAgentCall.count({ where: { agentId: agent.id, createdAt: { gte: day } } })));
  const mcpUrl = `${ctx.request.origin}/api/mcp`;

  // Admins choose the owner and the starting role.
  const people = canManage
    ? (await db.membership.findMany({ where: { status: "ACTIVE" }, include: { user: true }, orderBy: { createdAt: "asc" } }))
        .filter((membership) => !isAgentEmail(membership.user.email))
        .map((membership) => ({ id: membership.userId, label: membership.user.name ? `${membership.user.name} (${membership.user.email})` : membership.user.email }))
    : [];
  const roles = canManage ? (await db.role.findMany({ orderBy: { name: "asc" } })).map((role) => ({ id: role.id, label: role.name })) : [];

  return (
    <div className="min-w-0 space-y-4">
      <Flash error={query.error} notice={query.notice} />
      <section className="rounded-xl border border-line bg-white p-4">
        <h2 className="text-lg font-semibold">{canManage ? "All agents" : "Your agents"}</h2>
        {agents.length ? (
          <TableScroll>
            <table className="mt-3 w-full min-w-[760px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="py-2 pr-3">Agent</th>
                  <th className="py-2 pr-3">Platform</th>
                  <th className="py-2 pr-3">Belongs to</th>
                  <th className="py-2 pr-3">Access</th>
                  <th className="py-2 pr-3">Connects with</th>
                  <th className="py-2 pr-3">Last active</th>
                  <th className="py-2 pr-3">Calls (24h)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {agents.map((agent, index) => (
                  <tr key={agent.id}>
                    <td className="py-2 pr-3">
                      <Link href={`/agents/${agent.id}`} className="inline-flex min-h-11 items-center gap-2 font-semibold text-accent">
                        {agent.name}
                      </Link>
                      {agent.pausedAt ? (
                        <Badge tone="warn" className="ml-2">
                          Paused
                        </Badge>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge tone="accent">{agentPlatformLabel(agent.platform)}</Badge>
                    </td>
                    <td className="py-2 pr-3">{agent.ownerUserId === me ? "You" : ownerName.get(agent.ownerUserId) ?? "Unknown"}</td>
                    <td className="py-2 pr-3">{roleOf.get(agent.userId) ?? "—"}</td>
                    <td className="py-2 pr-3">{agent.connection === "oauth" ? "Sign-in (connector)" : "API key"}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{when(agent.lastActiveAt)}</td>
                    <td className="py-2 pr-3">{counts[index] ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        ) : (
          <p className="mt-2 text-sm text-muted">No agents yet. Connect one below.</p>
        )}
      </section>

      <section className="grid min-w-0 gap-4 xl:grid-cols-2">
        <div className="min-w-0 rounded-xl border border-line bg-white p-4">
          <h2 className="text-base font-semibold">Connect with sign-in (Claude, ChatGPT)</h2>
          <p className="mt-1 text-sm text-muted">
            Add PubCommand as a custom connector in your AI app with this address. The app opens PubCommand, you sign in, and approve. The agent is created for you and starts with your access.
          </p>
          <code className="mt-3 block break-all rounded bg-canvas px-2 py-2 font-mono text-xs text-ink">{mcpUrl}</code>
          <Link href="/agents/help" className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-accent">
            Step-by-step for each AI app
          </Link>
        </div>
        <div className="min-w-0 rounded-xl border border-line bg-white p-4">
          <h2 className="text-base font-semibold">Connect with an API key (Grok, OpenAI API, scripts)</h2>
          <p className="mb-3 mt-1 text-sm text-muted">For agents you run through an API, where you paste the MCP address and a key. The AI usage stays on that AI account.</p>
          <AgentKeyForm
            action={createAgentWithKey}
            mcpUrl={mcpUrl}
            platforms={AGENT_PLATFORMS.map((platform) => ({ id: platform.id, label: platform.label }))}
            owners={canManage ? people : undefined}
            roles={canManage ? roles : undefined}
            me={me}
          />
        </div>
      </section>
    </div>
  );
}
