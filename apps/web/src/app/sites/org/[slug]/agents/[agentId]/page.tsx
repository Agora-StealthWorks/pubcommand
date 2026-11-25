import { AGENT_PLATFORMS, agentPlatformLabel, can } from "@pubcommand/core";
import { rawPrisma, tenantDb } from "@pubcommand/db";
import { Badge, Button, Input, Label } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TableScroll } from "@/components/table-scroll";
import { Denied, Flash } from "@/components/ui";
import { newAgentKey, removeAgent, revokeAgentToken, setAgentPaused, updateAgent } from "@/features/agents/actions";
import { AgentKeyForm } from "@/features/agents/key-form";
import { agentsPage, when } from "@/features/agents/page-access";

const STATUS_TONE = { ok: "ok", error: "danger", denied: "warn", rate_limited: "warn" } as const;

export default async function AgentPage({ params, searchParams }: { params: Promise<{ slug: string; agentId: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug, agentId } = await params;
  const query = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(agentId)) notFound();
  const access = await agentsPage(slug);
  if (!access) notFound();
  const { ctx, canManage, me } = access;
  const db = tenantDb(ctx.resolved.id);
  const agent = await db.aiAgent.findFirst({ where: { id: agentId, removedAt: null } });
  if (!agent) notFound();
  if (!canManage && agent.ownerUserId !== me) return <Denied title="This agent belongs to someone else" />;

  const [owner, membership, tokens, calls, webPosts, textPosts] = await Promise.all([
    rawPrisma().user.findUnique({ where: { id: agent.ownerUserId }, select: { name: true, email: true } }),
    db.membership.findFirst({ where: { userId: agent.userId }, include: { role: true } }),
    db.aiAgentToken.findMany({ where: { agentId: agent.id, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, orderBy: { createdAt: "desc" } }),
    db.aiAgentCall.findMany({ where: { agentId: agent.id }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.webPost.findMany({ where: { deletedAt: null, OR: [{ createdById: agent.userId }, { updatedById: agent.userId }] }, orderBy: { updatedAt: "desc" }, take: 10 }),
    db.textPost.findMany({ where: { deletedAt: null, createdById: agent.userId }, orderBy: { updatedAt: "desc" }, take: 10 }),
  ]);
  const keys = tokens.filter((token) => token.kind === "key");
  // OAuth connections: one per connector (client), live while a refresh token is.
  const clientIds = [...new Set(tokens.filter((token) => token.kind === "refresh" && token.clientId).map((token) => token.clientId!))];
  const clients = clientIds.length ? await rawPrisma().agentOauthClient.findMany({ where: { id: { in: clientIds } } }) : [];
  const lastUse = (clientId: string) =>
    tokens.filter((token) => token.clientId === clientId).reduce<Date | null>((latest, token) => (token.lastUsedAt && (!latest || token.lastUsedAt > latest) ? token.lastUsedAt : latest), null);
  const canEditAccess = can(ctx.subject, "settings.users.manage", ctx.scope);
  const mcpUrl = `${ctx.request.origin}/api/mcp`;

  return (
    <div className="min-w-0 max-w-5xl space-y-4">
      <Link href="/agents" className="inline-flex min-h-11 items-center text-sm font-semibold text-accent">
        All agents
      </Link>
      <Flash error={query.error} notice={query.notice} />
      <section className="rounded-xl border border-line bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold">{agent.name}</h2>
          <Badge tone="accent">{agentPlatformLabel(agent.platform)}</Badge>
          {agent.pausedAt ? <Badge tone="warn">Paused</Badge> : <Badge tone="ok">Active</Badge>}
        </div>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted">Belongs to</dt>
            <dd className="font-medium">{agent.ownerUserId === me ? "You" : owner?.name || owner?.email || "Unknown"}</dd>
          </div>
          <div>
            <dt className="text-muted">AI platform</dt>
            <dd className="font-medium">{AGENT_PLATFORMS.find((platform) => platform.id === agent.platform)?.vendor ?? "Other"}</dd>
          </div>
          <div>
            <dt className="text-muted">Access</dt>
            <dd className="font-medium">
              {membership?.role.name ?? "—"}
              {canEditAccess ? (
                <Link href={`/settings/users/${agent.userId}`} className="ml-2 font-semibold text-accent">
                  Change role or app access
                </Link>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Last active</dt>
            <dd className="font-medium">{when(agent.lastActiveAt)}</dd>
          </div>
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <form action={setAgentPaused}>
            <input type="hidden" name="agentId" value={agent.id} />
            <input type="hidden" name="paused" value={agent.pausedAt ? "0" : "1"} />
            <Button type="submit" variant="secondary">
              {agent.pausedAt ? "Resume" : "Pause"}
            </Button>
          </form>
        </div>
      </section>

      <section className="rounded-xl border border-line bg-white p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Connections</h3>
        {clients.length || keys.length ? (
          <ul className="mt-2 divide-y divide-line text-sm">
            {clients.map((client) => (
              <li key={client.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-semibold">{client.name}</span> <span className="text-muted">· signed in through the connector · last used {when(lastUse(client.id))}</span>
                </span>
                <form action={revokeAgentToken}>
                  <input type="hidden" name="agentId" value={agent.id} />
                  <input type="hidden" name="clientId" value={client.id} />
                  <Button type="submit" variant="ghost" size="sm" className="text-[#b42318]">
                    Disconnect
                  </Button>
                </form>
              </li>
            ))}
            {keys.map((key) => (
              <li key={key.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-mono text-xs font-semibold">{key.prefix}…</span> <span className="text-muted">· API key · made {when(key.createdAt)} · last used {when(key.lastUsedAt)}</span>
                </span>
                <form action={revokeAgentToken}>
                  <input type="hidden" name="agentId" value={agent.id} />
                  <input type="hidden" name="tokenId" value={key.id} />
                  <Button type="submit" variant="ghost" size="sm" className="text-[#b42318]">
                    Revoke
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">Not connected. Make an API key below, or connect it with sign-in from its AI app.</p>
        )}
        <div className="mt-3 max-w-xl">
          <AgentKeyForm action={newAgentKey} mcpUrl={mcpUrl} agentId={agent.id} />
        </div>
      </section>

      <section className="rounded-xl border border-line bg-white p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Recent work</h3>
        {webPosts.length || textPosts.length ? (
          <ul className="mt-2 divide-y divide-line text-sm">
            {webPosts.map((post) => (
              <li key={post.id} className="flex flex-wrap items-center gap-2 py-2">
                <Link href={`/websites/posts/${post.id}`} className="font-semibold text-accent">
                  {post.title}
                </Link>
                <Badge>{post.status}</Badge>
                <span className="text-muted">Website · {when(post.updatedAt)}</span>
              </li>
            ))}
            {textPosts.map((post) => (
              <li key={post.id} className="flex flex-wrap items-center gap-2 py-2">
                <Link href={`/mini-blog/${post.siteId}/posts/${post.id}`} className="font-semibold text-accent">
                  {post.title}
                </Link>
                <Badge>{post.status}</Badge>
                <span className="text-muted">Mini-Blog · {when(post.updatedAt)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">No posts yet.</p>
        )}
        <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-muted">Activity</h3>
        {calls.length ? (
          <TableScroll>
            <table className="w-full min-w-[560px] text-left text-sm">
              <tbody className="divide-y divide-line">
                {calls.map((call) => (
                  <tr key={call.id}>
                    <td className="py-1.5 pr-3 whitespace-nowrap text-muted">{when(call.createdAt)}</td>
                    <td className="py-1.5 pr-3 font-mono text-xs">{call.tool}</td>
                    <td className="py-1.5 pr-3">
                      <Badge tone={STATUS_TONE[call.status as keyof typeof STATUS_TONE] ?? "neutral"}>{call.status.replace("_", " ")}</Badge>
                    </td>
                    <td className="py-1.5 pr-3 text-muted">{call.message ?? ""}</td>
                    <td className="py-1.5 text-muted">{call.durationMs} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        ) : (
          <p className="text-sm text-muted">No activity yet.</p>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <form action={updateAgent} className="space-y-3 rounded-xl border border-line bg-white p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Name and platform</h3>
          <input type="hidden" name="agentId" value={agent.id} />
          <div>
            <Label htmlFor="agent-name">Name</Label>
            <Input id="agent-name" name="name" defaultValue={agent.name} maxLength={80} required className="mt-1" />
          </div>
          <div>
            <Label htmlFor="agent-platform">AI platform</Label>
            <select id="agent-platform" name="platform" defaultValue={agent.platform} className="pc-control mt-1 w-full">
              {AGENT_PLATFORMS.map((platform) => (
                <option key={platform.id} value={platform.id}>
                  {platform.label}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" variant="secondary">
            Save
          </Button>
        </form>
        <form action={removeAgent} className="space-y-3 rounded-xl border border-[#fecdca] bg-white p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[#b42318]">Remove agent</h3>
          <p className="text-sm text-muted">It loses access at once and every connection stops. Its posts stay as they are.</p>
          <input type="hidden" name="agentId" value={agent.id} />
          <div>
            <Label htmlFor="agent-confirm">Type “{agent.name}” to confirm</Label>
            <Input id="agent-confirm" name="confirm" required className="mt-1" autoComplete="off" />
          </div>
          <Button type="submit" variant="danger">
            Remove
          </Button>
        </form>
      </section>
    </div>
  );
}
