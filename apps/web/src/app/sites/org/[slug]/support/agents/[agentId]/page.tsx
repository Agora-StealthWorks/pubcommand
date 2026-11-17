import { tenantDb } from "@pubcommand/db";
import { Badge, Button, Input, Label, Textarea } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TableScroll } from "@/components/table-scroll";
import { Denied, Flash } from "@/components/ui";
import { deleteProfileAction, pushProfileAction, rotateKeyAction, saveProfileAction, webhookSecretAction } from "@/features/support/actions";
import { AutoRefresh, SecretButton } from "@/features/support/client";
import { fmtDate } from "@/features/support/data";
import { UUID, supportPage } from "@/features/support/guard";
import { agentMaterial } from "@/features/support/platform";
import { ScopeFields } from "@/features/support/scope-fields";
import { searchKnowledge } from "@/features/support/search";
import { Section, categoryLabel } from "@/features/support/ui";
import { currentRequest } from "@/lib/request";

function syncLine(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const v = value as { push?: Record<string, unknown>; pull?: Record<string, unknown>; error?: string; at?: string };
  if (v.error) return `Failed: ${v.error}`;
  const parts: string[] = [];
  if (v.push) parts.push(`pushed ${String(v.push.create ?? 0)} new, ${String(v.push.update ?? 0)} updated, ${String(v.push.remove ?? 0)} removed, ${String(v.push.unchanged ?? 0)} unchanged, ${String(v.push.held ?? 0)} held, ${String(v.push.tools ?? 0)} tools`);
  if (v.pull) parts.push(`checked ${String(v.pull.checked ?? 0)}, ${String(v.pull.changed ?? 0)} edited in ElevenLabs`);
  return parts.join("; ");
}

function listOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

export default async function SupportAgentPage({ params, searchParams }: { params: Promise<{ slug: string; agentId: string }>; searchParams: Promise<{ error?: string; notice?: string; q?: string }> }) {
  const { slug, agentId } = await params;
  const query = await searchParams;
  const access = await supportPage(slug);
  if (access.kind === "missing" || !UUID.test(agentId)) notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx } = access;
  const db = tenantDb(ctx.resolved.id);
  const profile = await db.supportAgentProfile.findFirst({ where: { id: agentId, brandId: ctx.brand.id, deletedAt: null } });
  if (!profile) notFound();
  const { origin } = await currentRequest();
  const [material, calls, docStates, connected] = await Promise.all([
    agentMaterial(ctx.resolved.id, profile, origin),
    db.supportApiCall.findMany({ where: { profileId: profile.id }, orderBy: { createdAt: "desc" }, take: 15 }),
    db.supportPlatformDoc.findMany({ where: { profileId: profile.id }, select: { kind: true, status: true } }),
    db.supportConnection.count({ where: { brandId: ctx.brand.id, platform: "elevenlabs" } }),
  ]);
  const q = (query.q ?? "").trim().slice(0, 300);
  const hits = q ? await searchKnowledge({ organizationId: ctx.resolved.id, brandId: ctx.brand.id, scope: material.scope }, q, { k: 5 }) : [];
  const running = profile.syncStatus === "queued" || profile.syncStatus === "running";
  const result = (profile.lastSyncResult ?? {}) as { push?: { errors?: unknown; warnings?: unknown } };
  const errors = listOfStrings(result.push?.errors);
  const warnings = listOfStrings(result.push?.warnings);
  const count = (kind: string, status: string) => docStates.filter((d) => d.kind === kind && d.status === status).length;
  const webhookUrl = `${origin}/api/v1/support/webhooks/post-call?agent=${profile.id}`;

  return (
    <div className="space-y-4">
      {running ? <AutoRefresh /> : null}
      <Link href="/support/agents" className="text-sm text-accent">
        ← Agents
      </Link>
      <Flash error={query.error} notice={query.notice} />
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 text-lg font-semibold [overflow-wrap:anywhere]">{profile.name}</h2>
        <Badge tone={profile.active && profile.keyHash ? "ok" : "warn"}>{!profile.keyHash ? "No key" : profile.active ? "Live" : "Off"}</Badge>
      </div>
      <p className="text-sm text-muted [overflow-wrap:anywhere]">
        Reads {material.scope.categories.map(categoryLabel).join(", ") || "nothing yet"} · {material.scope.audiences.map((a) => (a === "public" ? "public" : "members-only")).join(" and ") || "no audience"} · {material.docs.length} document
        {material.docs.length === 1 ? "" : "s"} · {material.tools.length} tool{material.tools.length === 1 ? "" : "s"}
      </p>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <Section title="API key" description="The key is the agent's scope. It is shown once; only its hash is stored.">
            <p className="text-sm">{profile.keyPrefix ? <>Current key starts <code>{profile.keyPrefix}…</code>, made {fmtDate(profile.keyCreatedAt)}.</> : "No key yet."}</p>
            {ctx.canPublish ? (
              <div className="mt-3">
                <SecretButton action={rotateKeyAction} hidden={{ profileId: profile.id }} label={profile.keyPrefix ? "Replace key" : "Make key"} confirm={profile.keyPrefix ? "The old key stops working at once. Continue?" : undefined} />
              </div>
            ) : null}
            <div className="mt-4 text-sm">
              <p className="font-semibold">Endpoints</p>
              <ul className="mt-1 space-y-1 text-xs text-muted">
                {material.tools.map((tool) => (
                  <li key={tool.name} className="break-all">
                    <code>GET {origin}/api/v1/support{tool.path}</code> · {tool.name}
                  </li>
                ))}
              </ul>
            </div>
          </Section>

          <Section title="Try a question" description="Answers exactly what this agent's key would get.">
            <form className="flex min-w-0 flex-wrap gap-2" role="search">
              <Input name="q" defaultValue={q} placeholder="How do I cancel?" aria-label="Question" className="min-w-0 flex-1" />
              <Button type="submit" variant="secondary">
                Search
              </Button>
            </form>
            {q ? (
              hits.length ? (
                <ol className="mt-3 space-y-2 text-sm">
                  {hits.map((hit, i) => (
                    <li key={`${hit.recordId}-${i}`} className="min-w-0 rounded-md border border-line p-2">
                      <Link href={`/support/records/${hit.recordId}`} className="font-medium text-accent [overflow-wrap:anywhere]">
                        {hit.title}
                      </Link>
                      <span className="ml-2 text-xs text-muted">{categoryLabel(hit.category)}</span>
                      <p className="mt-1 line-clamp-3 text-muted [overflow-wrap:anywhere]">{hit.content}</p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-3 text-sm text-muted">Nothing in this agent&apos;s scope. That is a gap.</p>
              )
            ) : null}
          </Section>

          <Section title="Agent guide" description="The system prompt for this agent, built from its settings and the brand profile. Platform-neutral.">
            <div className="flex flex-wrap gap-2">
              <a href={`/support/agents/${profile.id}/guide`} className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold hover:bg-canvas">
                Download guide (.md)
              </a>
              <a href={`/support/agents/${profile.id}/bundle`} className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold hover:bg-canvas">
                Download bundle (.zip)
              </a>
            </div>
            <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-canvas p-3 text-xs">{material.guide}</pre>
          </Section>
        </div>

        <div className="min-w-0 space-y-4">
          {ctx.canPublish ? (
            <Section title="Settings">
              <form action={saveProfileAction} className="space-y-4">
                <input type="hidden" name="profileId" value={profile.id} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="min-w-0">
                    <Label htmlFor="p-name">Name</Label>
                    <Input id="p-name" name="name" defaultValue={profile.name} required maxLength={80} />
                  </div>
                  <div className="min-w-0">
                    <Label htmlFor="p-persona">Persona name</Label>
                    <Input id="p-persona" name="personaName" defaultValue={profile.personaName} maxLength={60} />
                  </div>
                  <div className="min-w-0">
                    <Label htmlFor="p-surface">Where it runs</Label>
                    <select id="p-surface" name="surface" defaultValue={profile.surface} className="pc-control w-full">
                      <option value="chat">Website chat</option>
                      <option value="member-chat">Member chat</option>
                      <option value="phone">Phone</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div className="min-w-0">
                    <Label htmlFor="p-rate">Requests a minute</Label>
                    <Input id="p-rate" name="rateLimit" type="number" min={1} max={1200} defaultValue={profile.rateLimit} />
                  </div>
                </div>
                <ScopeFields niche={ctx.profile.niche} categories={profile.categories} audiences={profile.audiences} />
                <div>
                  <Label htmlFor="p-first">Opening line (optional)</Label>
                  <Input id="p-first" name="firstMessage" defaultValue={profile.firstMessage} maxLength={500} placeholder={`Hi, I'm ${profile.personaName}. How can I help?`} />
                </div>
                <div>
                  <Label htmlFor="p-esc">When it cannot help</Label>
                  <Textarea id="p-esc" name="escalation" defaultValue={profile.escalation} rows={2} maxLength={1000} placeholder="Offer the customer service email and phone number." />
                </div>
                <div>
                  <Label htmlFor="p-ins">Extra instructions (one per line)</Label>
                  <Textarea id="p-ins" name="instructions" defaultValue={profile.instructions} rows={4} maxLength={4000} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="min-w-0">
                    <Label htmlFor="p-agent">ElevenLabs agent id (optional)</Label>
                    <Input id="p-agent" name="remoteAgentId" defaultValue={profile.remoteAgentId ?? ""} maxLength={120} placeholder="agent_…" />
                  </div>
                  <div className="min-w-0 space-y-1 pt-6 text-sm">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" name="autoSync" defaultChecked={profile.autoSync} /> Sync with ElevenLabs every 15 minutes
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" name="active" value="on" defaultChecked={profile.active} /> Key works (untick to pause)
                    </label>
                    <input type="hidden" name="active" value="off" />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit">Save</Button>
                  <Button type="submit" variant="danger" formAction={deleteProfileAction} formNoValidate>
                    Remove agent
                  </Button>
                </div>
              </form>
            </Section>
          ) : null}

          <Section title="ElevenLabs sync" description="Pushes the documents, the guide and the tools; pulls edits made in ElevenLabs into the review queue. Decided by content hash, so unchanged documents are not sent again.">
            {!connected ? (
              <p className="text-sm text-muted">
                Not connected. Add your ElevenLabs API key on the <Link href="/support/agents" className="text-accent">Agents</Link> page, or download the bundle and upload it by hand.
              </p>
            ) : (
              <>
                <p className="text-sm">
                  Status: <strong>{profile.syncStatus}</strong>
                  {profile.lastPushedAt ? ` · last push ${fmtDate(profile.lastPushedAt)}` : ""}
                  {syncLine(profile.lastSyncResult) ? ` · ${syncLine(profile.lastSyncResult)}` : ""}
                </p>
                <p className="mt-1 text-xs text-muted">
                  Documents: {count("doc", "synced")} synced, {count("doc", "remote_changed")} edited there (held), {count("doc", "error")} failed. Tools: {count("tool", "synced")}.
                  {profile.remoteSecretId ? " Tools authenticate with a workspace secret." : " Tools need the agent key once."}
                </p>
                {warnings.length ? <ul className="mt-2 list-disc pl-5 text-sm text-[#b54708]">{warnings.map((w) => <li key={w}>{w}</li>)}</ul> : null}
                {errors.length ? <ul className="mt-2 list-disc pl-5 text-sm text-[#b42318]">{errors.slice(0, 8).map((e) => <li key={e} className="[overflow-wrap:anywhere]">{e}</li>)}</ul> : null}
                {ctx.canPublish ? (
                  <form action={pushProfileAction} className="mt-3 space-y-2">
                    <input type="hidden" name="profileId" value={profile.id} />
                    {!profile.remoteSecretId ? (
                      <div>
                        <Label htmlFor="p-key">Agent key, for the tools (optional, used once)</Label>
                        <Input id="p-key" name="agentKey" type="password" autoComplete="off" placeholder="psk_…" />
                        <p className="mt-1 text-xs text-muted">Stored only as an ElevenLabs workspace secret, never here.</p>
                      </div>
                    ) : null}
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="force" /> Overwrite edits made in ElevenLabs
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" name="mode" value="push" disabled={running}>
                        {running ? "Working…" : "Push now"}
                      </Button>
                      <Button type="submit" name="mode" value="pull" variant="secondary" disabled={running}>
                        Check for edits
                      </Button>
                    </div>
                  </form>
                ) : null}
              </>
            )}
          </Section>

          <Section title="Post-call webhook (gaps)" description="Point the ElevenLabs post-call webhook here. Questions the agent could not answer land in Gaps; the transcript itself is not stored.">
            <p className="break-all text-xs">
              <code>{webhookUrl}</code>
            </p>
            <p className="mt-1 text-sm text-muted">{profile.webhookSecretEnc ? "A signing secret is set." : "No signing secret yet: calls are refused until one is set."}</p>
            {ctx.canPublish ? (
              <div className="mt-3">
                <SecretButton action={webhookSecretAction} hidden={{ profileId: profile.id }} label={profile.webhookSecretEnc ? "Replace signing secret" : "Make signing secret"} />
              </div>
            ) : null}
          </Section>

          <Section title="Recent calls" description="Every API call is logged (tool, query, hits, status).">
            {calls.length ? (
              <TableScroll>
                <table className="w-full text-left text-xs">
                  <thead className="text-muted">
                    <tr>
                      <th className="py-1 pr-2">When</th>
                      <th className="py-1 pr-2">Tool</th>
                      <th className="py-1 pr-2">Query</th>
                      <th className="py-1 pr-2">Hits</th>
                      <th className="py-1">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calls.map((c) => (
                      <tr key={c.id} className="border-t border-line">
                        <td className="whitespace-nowrap py-1 pr-2">{c.createdAt.toISOString().slice(5, 16).replace("T", " ")}</td>
                        <td className="py-1 pr-2">{c.tool}</td>
                        <td className="max-w-[16rem] truncate py-1 pr-2">{c.query}</td>
                        <td className="py-1 pr-2">{c.hits}</td>
                        <td className="py-1">{c.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            ) : (
              <p className="text-sm text-muted">No calls yet.</p>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
