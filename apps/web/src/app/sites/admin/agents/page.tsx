import { AGENT_PLATFORMS, agentPlatformLabel } from "@pubcommand/core";
import { platformTx, rawPrisma, tenantDb } from "@pubcommand/db";
import { mainBrain } from "@/features/main-brain/db";
import { Badge, Button } from "@pubcommand/ui";
import Link from "next/link";
import { TableScroll } from "@/components/table-scroll";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { AgentKeyForm } from "@/features/agents/key-form";
import { cursorInstallLink } from "@/features/agents/cursor";
import { when } from "@/features/agents/page-access";
import { superAdminCtx } from "@/features/agents/platform-access";
import { createPlatformAgentWithKey, restoreAgentDeletedNotes } from "@/features/agents/platform-actions";

/** Admin console → AI Agents: super admins' platform agents, and every organization's agents. */
export default async function PlatformAgentsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const query = await searchParams;
  const ctx = await superAdminCtx();
  if (!ctx) return <Denied title="Only super admins can manage platform AI agents" />;
  const day = new Date(Date.now() - 86_400_000);
  const [agents, calls] = await platformTx((tx) =>
    Promise.all([
      tx.aiAgent.findMany({ where: { removedAt: null }, orderBy: [{ scope: "desc" }, { createdAt: "asc" }] }),
      tx.aiAgentCall.groupBy({ by: ["agentId", "status"], where: { createdAt: { gte: day } }, _count: { _all: true } }),
    ]),
  );
  const [orgs, owners] = await Promise.all([
    rawPrisma().organization.findMany({ where: { id: { in: [...new Set(agents.map((agent) => agent.organizationId))] } }, select: { id: true, name: true } }),
    rawPrisma().user.findMany({ where: { id: { in: [...new Set(agents.map((agent) => agent.ownerUserId))] } }, select: { id: true, name: true, email: true } }),
  ]);
  const orgName = new Map(orgs.map((org) => [org.id, org.name]));
  const ownerName = new Map(owners.map((owner) => [owner.id, owner.name || owner.email]));
  const count = (agentId: string, errors = false) => calls.filter((row) => row.agentId === agentId && (!errors || row.status !== "ok")).reduce((sum, row) => sum + row._count._all, 0);
  const platformAgents = agents.filter((agent) => agent.scope === "platform");
  // Notes AI agents deleted in the last 30 days, each batch restorable here.
  const deletions = await rawPrisma().platformAuditLog.findMany({ where: { action: "agents.notes.deleted", createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }, orderBy: { createdAt: "desc" }, take: 30 });
  // A batch counts as restored once none of its notes are still deleted (restored by staff or by an agent).
  const restoredBatches = new Set<string>();
  for (const row of deletions) {
    const meta = (row.metadata ?? {}) as { kind?: string; organizationId?: string | null; noteIds?: unknown };
    const noteIds = Array.isArray(meta.noteIds) ? meta.noteIds.filter((id): id is string => typeof id === "string") : [];
    const stillDeleted =
      meta.kind === "master"
        ? await mainBrain((tx) => tx.mainBrainNote.count({ where: { id: { in: noteIds }, deletedAt: { not: null } } }))
        : meta.organizationId
          ? await tenantDb(meta.organizationId).knowledgePage.count({ where: { id: { in: noteIds }, deletedAt: { not: null } } })
          : 0;
    if (stillDeleted === 0) restoredBatches.add(row.id);
  }
  const deletionOrgIds = deletions.map((row) => (row.metadata as { organizationId?: string | null } | null)?.organizationId).filter((id): id is string => Boolean(id) && !orgName.has(id!));
  if (deletionOrgIds.length) for (const org of await rawPrisma().organization.findMany({ where: { id: { in: deletionOrgIds } }, select: { id: true, name: true } })) orgName.set(org.id, org.name);
  const orgAgents = agents.filter((agent) => agent.scope !== "platform");
  const mcpUrl = `${ctx.request.origin}/api/mcp`;

  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        title="AI Agents"
        description="Platform agents belong to a super admin and work on the whole platform: the Master Brain, monitoring, every organization's Brain, and (when allowed) audited admin changes. Below them, every organization's agents."
      />
      <Flash error={query.error} notice={query.notice} />
      <section className="rounded-xl border border-line bg-white p-4">
        <h2 className="text-lg font-semibold">Platform agents</h2>
        {platformAgents.length ? (
          <TableScroll>
            <table className="mt-3 w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="py-2 pr-3">Agent</th>
                  <th className="py-2 pr-3">Platform</th>
                  <th className="py-2 pr-3">Belongs to</th>
                  <th className="py-2 pr-3">Admin changes</th>
                  <th className="py-2 pr-3">Last active</th>
                  <th className="py-2 pr-3">Calls (24h)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {platformAgents.map((agent) => (
                  <tr key={agent.id}>
                    <td className="py-2 pr-3">
                      <Link href={`/agents/${agent.id}`} className="inline-flex min-h-11 items-center font-semibold text-accent">
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
                    <td className="py-2 pr-3">{agent.ownerUserId === ctx.userId ? "You" : ownerName.get(agent.ownerUserId)}</td>
                    <td className="py-2 pr-3">{agent.allowAdminActions ? "Allowed" : "Read-only"}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{when(agent.lastActiveAt)}</td>
                    <td className="py-2 pr-3">{count(agent.id)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        ) : (
          <p className="mt-2 text-sm text-muted">No platform agents yet.</p>
        )}
      </section>

      <section className="grid min-w-0 gap-4 xl:grid-cols-2">
        <div className="min-w-0 rounded-xl border border-line bg-white p-4">
          <h2 className="text-base font-semibold">Log in (GrokBot, Claude, ChatGPT)</h2>
          <p className="mt-1 text-sm text-muted">The app opens the console; log in as a super admin and approve. Its AI usage stays on your own AI account.</p>
          <a href={cursorInstallLink("PubCommand Platform", mcpUrl)} className="mt-3 inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-sm font-semibold text-white">
            Add to GrokBot
          </a>
          <p className="mt-3 text-sm text-muted">For Claude or ChatGPT, add this address as a custom connector:</p>
          <code className="mt-1 block break-all rounded bg-canvas px-2 py-2 font-mono text-xs text-ink">{mcpUrl}</code>
        </div>
        <div className="min-w-0 rounded-xl border border-line bg-white p-4">
          <h2 className="text-base font-semibold">With an API key (Grok API, OpenAI API, scripts)</h2>
          <p className="mb-3 mt-1 text-sm text-muted">Send the key as Authorization: Bearer pca_… to the address on the left.</p>
          <AgentKeyForm action={createPlatformAgentWithKey} mcpUrl={mcpUrl} platforms={AGENT_PLATFORMS.map((platform) => ({ id: platform.id, label: platform.label }))} adminToggle />
        </div>
      </section>

      <section className="rounded-xl border border-line bg-white p-4">
        <h2 className="text-lg font-semibold">Notes deleted by AI agents</h2>
        <p className="mt-1 text-sm text-muted">The last 30 days. Restore brings a whole batch back.</p>
        {deletions.length ? (
          <ul className="mt-2 divide-y divide-line text-sm">
            {deletions.map((row) => {
              const meta = (row.metadata ?? {}) as { kind?: string; organizationId?: string | null; count?: number; reason?: string; agent?: string };
              return (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <span className="font-semibold">
                      {meta.count ?? 0} {meta.kind === "master" ? "Master Brain" : "Brain"} note{meta.count === 1 ? "" : "s"}
                    </span>
                    {meta.kind !== "master" && meta.organizationId ? <span className="text-muted"> · {orgName.get(meta.organizationId) ?? "organization"}</span> : null}
                    <span className="text-muted">
                      {" "}
                      · by {meta.agent ?? "an agent"} · {when(row.createdAt)}
                      {meta.reason ? ` · “${meta.reason}”` : ""}
                    </span>
                  </span>
                  {restoredBatches.has(row.id) ? (
                    <Badge tone="ok">Restored</Badge>
                  ) : (
                    <form action={restoreAgentDeletedNotes}>
                      <input type="hidden" name="auditId" value={row.id} />
                      <Button type="submit" variant="secondary" size="sm">
                        Restore
                      </Button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">None.</p>
        )}
      </section>

      <section className="rounded-xl border border-line bg-white p-4">
        <h2 className="text-lg font-semibold">Organization agents</h2>
        {orgAgents.length ? (
          <TableScroll>
            <table className="mt-3 w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="py-2 pr-3">Agent</th>
                  <th className="py-2 pr-3">Organization</th>
                  <th className="py-2 pr-3">Platform</th>
                  <th className="py-2 pr-3">Belongs to</th>
                  <th className="py-2 pr-3">Last active</th>
                  <th className="py-2 pr-3">Calls / problems (24h)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {orgAgents.map((agent) => (
                  <tr key={agent.id}>
                    <td className="py-2 pr-3 font-semibold">
                      {agent.name}
                      {agent.pausedAt ? (
                        <Badge tone="warn" className="ml-2">
                          Paused
                        </Badge>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3">
                      <Link href={`/orgs/${agent.organizationId}`} className="font-semibold text-accent">
                        {orgName.get(agent.organizationId) ?? "—"}
                      </Link>
                    </td>
                    <td className="py-2 pr-3">
                      <Badge tone="accent">{agentPlatformLabel(agent.platform)}</Badge>
                    </td>
                    <td className="py-2 pr-3">{ownerName.get(agent.ownerUserId) ?? "—"}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{when(agent.lastActiveAt)}</td>
                    <td className="py-2 pr-3">
                      {count(agent.id)} / <span className={count(agent.id, true) ? "font-semibold text-[#b42318]" : ""}>{count(agent.id, true)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        ) : (
          <p className="mt-2 text-sm text-muted">No organization has an agent yet.</p>
        )}
      </section>
    </div>
  );
}
