import { AGENT_PLATFORMS, agentPlatformLabel } from "@pubcommand/core";
import { rawPrisma, tenantDb } from "@pubcommand/db";
import { Badge, Button, Input, Label } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TableScroll } from "@/components/table-scroll";
import { Denied, Flash } from "@/components/ui";
import { AgentKeyForm } from "@/features/agents/key-form";
import { when } from "@/features/agents/page-access";
import { superAdminCtx } from "@/features/agents/platform-access";
import { newPlatformAgentKey, updatePlatformAgent } from "@/features/agents/platform-actions";

const STATUS_TONE = { ok: "ok", error: "danger", denied: "warn", rate_limited: "warn" } as const;

export default async function PlatformAgentPage({ params, searchParams }: { params: Promise<{ agentId: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { agentId } = await params;
  const query = await searchParams;
  const ctx = await superAdminCtx();
  if (!ctx) return <Denied title="Only super admins can manage platform AI agents" />;
  if (!/^[0-9a-f-]{36}$/i.test(agentId)) notFound();
  const db = tenantDb(ctx.consoleOrganizationId);
  const agent = await db.aiAgent.findFirst({ where: { id: agentId, scope: "platform", removedAt: null } });
  if (!agent) notFound();
  const [owner, tokens, calls] = await Promise.all([
    rawPrisma().user.findUnique({ where: { id: agent.ownerUserId }, select: { name: true, email: true } }),
    db.aiAgentToken.findMany({ where: { agentId: agent.id, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, orderBy: { createdAt: "desc" } }),
    db.aiAgentCall.findMany({ where: { agentId: agent.id }, orderBy: { createdAt: "desc" }, take: 80 }),
  ]);
  const keys = tokens.filter((token) => token.kind === "key");
  const clientIds = [...new Set(tokens.filter((token) => token.kind === "refresh" && token.clientId).map((token) => token.clientId!))];
  const clients = clientIds.length ? await rawPrisma().agentOauthClient.findMany({ where: { id: { in: clientIds } } }) : [];
  const hidden = (intent: string) => (
    <>
      <input type="hidden" name="agentId" value={agent.id} />
      <input type="hidden" name="intent" value={intent} />
    </>
  );

  return (
    <div className="min-w-0 max-w-5xl space-y-4">
      <Link href="/agents" className="inline-flex min-h-11 items-center text-sm font-semibold text-accent">
        All agents
      </Link>
      <Flash error={query.error} notice={query.notice} />
      <section className="rounded-xl border border-line bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{agent.name}</h1>
          <Badge tone="accent">{agentPlatformLabel(agent.platform)}</Badge>
          <Badge>Platform agent</Badge>
          {agent.pausedAt ? <Badge tone="warn">Paused</Badge> : <Badge tone="ok">Active</Badge>}
        </div>
        <p className="mt-2 text-sm text-muted">
          Belongs to {agent.ownerUserId === ctx.userId ? "you" : owner?.name || owner?.email}. Admin changes: {agent.allowAdminActions ? "allowed" : "not allowed (read-only)"}. Last active {when(agent.lastActiveAt)}. It stops working if its owner stops being an active super admin.
        </p>
        <form action={updatePlatformAgent} className="mt-3">
          {hidden(agent.pausedAt ? "resume" : "pause")}
          <Button type="submit" variant="secondary">
            {agent.pausedAt ? "Resume" : "Pause"}
          </Button>
        </form>
      </section>

      <section className="rounded-xl border border-line bg-white p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Connections</h2>
        {clients.length || keys.length ? (
          <ul className="mt-2 divide-y divide-line text-sm">
            {clients.map((client) => (
              <li key={client.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-semibold">{client.name}</span> <span className="text-muted">· signed in through the connector</span>
                </span>
                <form action={updatePlatformAgent}>
                  {hidden("revoke")}
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
                  <span className="font-mono text-xs font-semibold">{key.prefix}…</span> <span className="text-muted">· API key · last used {when(key.lastUsedAt)}</span>
                </span>
                <form action={updatePlatformAgent}>
                  {hidden("revoke")}
                  <input type="hidden" name="tokenId" value={key.id} />
                  <Button type="submit" variant="ghost" size="sm" className="text-[#b42318]">
                    Revoke
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">Not connected.</p>
        )}
        <div className="mt-3 max-w-xl">
          <AgentKeyForm action={newPlatformAgentKey} mcpUrl={`${ctx.request.origin}/api/mcp`} agentId={agent.id} />
        </div>
      </section>

      <section className="rounded-xl border border-line bg-white p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Activity</h2>
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
                    <td className="py-1.5 pr-3 text-muted">{call.message ?? (call.targetType ? `${call.targetType} ${call.targetId ?? ""}` : "")}</td>
                    <td className="py-1.5 text-muted">{call.durationMs} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        ) : (
          <p className="text-sm text-muted">No activity yet.</p>
        )}
        <p className="mt-2 text-xs text-muted">Admin changes it makes are also in the Audit page, under its name.</p>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <form action={updatePlatformAgent} className="space-y-3 rounded-xl border border-line bg-white p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Settings</h2>
          {hidden("save")}
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
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="allowAdminActions" defaultChecked={agent.allowAdminActions} className="mt-1 h-4 w-4" />
            <span>
              <span className="font-semibold">Can make admin changes</span>
              <span className="block text-muted">Suspend or resume organizations, change plans and app access, invite people, run jobs. Never deletes, passwords, 2FA, impersonation, staff or domains.</span>
            </span>
          </label>
          <Button type="submit" variant="secondary">
            Save
          </Button>
        </form>
        <form action={updatePlatformAgent} className="space-y-3 rounded-xl border border-[#fecdca] bg-white p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#b42318]">Remove agent</h2>
          <p className="text-sm text-muted">Every connection stops at once.</p>
          {hidden("remove")}
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
