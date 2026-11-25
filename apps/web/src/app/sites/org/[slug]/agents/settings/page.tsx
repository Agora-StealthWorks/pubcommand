import { Button } from "@pubcommand/ui";
import { notFound } from "next/navigation";
import { Flash } from "@/components/ui";
import { saveAgentSettings } from "@/features/agents/actions";
import { agentSettings } from "@/features/agents/data";
import { agentsPage } from "@/features/agents/page-access";

export default async function AgentSettingsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await agentsPage(slug);
  if (!access) notFound();
  const { allowPublishing } = await agentSettings(access.ctx.resolved.id);
  return (
    <div className="max-w-3xl space-y-4">
      <Flash error={query.error} notice={query.notice} />
      <form action={saveAgentSettings} className="space-y-3 rounded-xl border border-line bg-white p-4">
        <h2 className="text-base font-semibold">Publishing</h2>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="allowPublishing" defaultChecked={allowPublishing} disabled={!access.canManage} className="mt-1 h-4 w-4" />
          <span>
            <span className="font-semibold">Allow publishing by AI agents</span>
            <span className="block text-muted">
              On: an agent with publish rights publishes and schedules directly, like a person with the same role. Off: everything an agent publishes waits in Approvals until someone with publish
              rights approves it, and agents cannot change posts that are already live.
            </span>
          </span>
        </label>
        {access.canManage ? (
          <Button type="submit">Save</Button>
        ) : (
          <p className="text-sm text-muted">Only admins who manage AI agents can change this.</p>
        )}
      </form>
      <section className="space-y-2 rounded-xl border border-line bg-white p-4 text-sm">
        <h2 className="text-base font-semibold">How agents work here</h2>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          <li>An agent is a member of this organization only. It can never see or change another organization&apos;s content.</li>
          <li>It starts with the same access as the person it belongs to. Change its role or narrow its app access in Settings → Users, like anyone else&apos;s.</li>
          <li>It does not take a seat, and it cannot sign in to the PubCommand website: it works only through the MCP server with its own connection.</li>
          <li>Its AI runs on its owner&apos;s Claude, Grok or OpenAI account. PubCommand does not pay for or meter that usage.</li>
          <li>Everything it does is in its Activity list and the organization&apos;s Activity log. Pause or remove it at any time.</li>
          <li>Readers never see that a post came from an agent. Posts carry the byline set on them, as with any post.</li>
          <li>If its owner leaves the organization, the agent stops working.</li>
        </ul>
      </section>
    </div>
  );
}
