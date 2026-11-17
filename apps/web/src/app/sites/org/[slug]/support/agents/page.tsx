import { tenantDb } from "@pubcommand/db";
import { Badge, Button, Input, Label } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { connectElevenAction, createProfileAction } from "@/features/support/actions";
import { fmtDate } from "@/features/support/data";
import { supportPage } from "@/features/support/guard";
import { ScopeFields } from "@/features/support/scope-fields";
import { Empty, Section, categoryLabel } from "@/features/support/ui";

export default async function SupportAgentsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await supportPage(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx } = access;
  const db = tenantDb(ctx.resolved.id);
  const [profiles, connection] = await Promise.all([
    db.supportAgentProfile.findMany({ where: { brandId: ctx.brand.id, deletedAt: null }, orderBy: { name: "asc" } }),
    db.supportConnection.findFirst({ where: { brandId: ctx.brand.id, platform: "elevenlabs" }, select: { keyHint: true, updatedAt: true } }),
  ]);

  return (
    <div className="space-y-4">
      <Flash error={query.error} notice={query.notice} />
      <Section title="Agents" description="One per place a customer can ask: website chat, member chat, phone. Each has its own key, and the key decides what it may read.">
        {profiles.length ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {profiles.map((p) => (
              <li key={p.id} className="min-w-0">
                <Link href={`/support/agents/${p.id}`} className="block h-full min-w-0 rounded-lg border border-line p-4 hover:border-accent">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold [overflow-wrap:anywhere]">{p.name}</span>
                    <Badge tone={p.active && p.keyHash ? "ok" : "warn"}>{!p.keyHash ? "No key" : p.active ? "Live" : "Off"}</Badge>
                    {p.platform === "elevenlabs" ? <Badge tone="accent">ElevenLabs</Badge> : null}
                  </span>
                  <span className="mt-1 block text-sm text-muted">
                    {p.personaName} · {p.surface} · {p.audiences.map((a) => (a === "public" ? "public" : "members")).join(" + ") || "no audience"}
                  </span>
                  <span className="mt-1 block text-xs text-muted [overflow-wrap:anywhere]">{p.categories.map(categoryLabel).join(", ") || "No categories yet"}</span>
                  <span className="mt-1 block text-xs text-muted">{p.lastUsedAt ? `Last call ${fmtDate(p.lastUsedAt)}` : "Not used yet"}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No agents yet.</Empty>
        )}
      </Section>

      {ctx.canPublish ? (
        <Section title="New agent">
          <form action={createProfileAction} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="min-w-0">
                <Label htmlFor="a-name">Name</Label>
                <Input id="a-name" name="name" required maxLength={80} placeholder="Website chat" />
              </div>
              <div className="min-w-0">
                <Label htmlFor="a-persona">Persona name</Label>
                <Input id="a-persona" name="personaName" defaultValue="Merlin" maxLength={60} />
              </div>
              <div className="min-w-0">
                <Label htmlFor="a-surface">Where it runs</Label>
                <select id="a-surface" name="surface" className="pc-control w-full" defaultValue="chat">
                  <option value="chat">Website chat</option>
                  <option value="member-chat">Member chat</option>
                  <option value="phone">Phone</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
            <ScopeFields niche={ctx.profile.niche} categories={["products", "editors", "howto", "billing", "pricing", "faqs", "issues"]} audiences={["public"]} />
            <Button type="submit">Create agent</Button>
          </form>
        </Section>
      ) : null}

      <Section title="ElevenLabs" description="Optional. With your own ElevenLabs API key, agents can be pushed to ElevenLabs Conversational AI and kept in sync. Without it, download each agent's bundle and upload it by hand.">
        {connection ? (
          <p className="text-sm">
            Connected with key <code>{connection.keyHint}</code> (stored encrypted, updated {fmtDate(connection.updatedAt)}).
          </p>
        ) : (
          <p className="text-sm text-muted">Not connected.</p>
        )}
        {ctx.canPublish ? (
          <form action={connectElevenAction} className="mt-3 flex min-w-0 flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <Label htmlFor="el-key">{connection ? "Replace API key" : "ElevenLabs API key"}</Label>
              <Input id="el-key" name="apiKey" type="password" autoComplete="off" placeholder="Paste the key" />
            </div>
            <Button type="submit" name="intent" value="connect">
              {connection ? "Replace" : "Connect"}
            </Button>
            {connection ? (
              <Button type="submit" name="intent" value="disconnect" variant="danger" formNoValidate>
                Disconnect
              </Button>
            ) : null}
          </form>
        ) : null}
      </Section>
    </div>
  );
}
