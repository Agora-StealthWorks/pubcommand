import { notFound } from "next/navigation";
import { agentsPage } from "@/features/agents/page-access";

function Step({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border border-line bg-white p-4 text-sm">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="mt-2 space-y-2 text-ink">{children}</div>
    </section>
  );
}

function Code({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded bg-canvas px-3 py-2 font-mono text-xs text-ink">{children}</pre>;
}

const TOOLS = [
  ["whoami", "Its organization, owner, brands, permissions, and whether its publishing goes live or waits for approval."],
  ["list_brands", "The brands it can work in."],
  ["list_websites · list_editors", "Websites of a brand, and editor profiles for bylines."],
  ["list_website_posts · get_website_post", "Read posts and pages."],
  ["create_website_post · update_website_post", "Write, edit, publish or schedule posts and pages."],
  ["list_miniblogs · list_miniblog_posts · get_miniblog_post", "Read Mini-Blogs and their posts."],
  ["create_miniblog_post · update_miniblog_post", "Write, edit and publish Mini-Blog posts."],
];

export default async function AgentsHelpPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = await agentsPage(slug);
  if (!access) notFound();
  const url = `${access.ctx.request.origin}/api/mcp`;
  return (
    <div className="min-w-0 max-w-4xl space-y-4">
      <Step title="The address">
        <p>Every agent uses the same PubCommand MCP server for this organization:</p>
        <Code>{url}</Code>
        <p className="text-muted">
          Agents sign in one of two ways. Apps with connectors (Claude, ChatGPT) send you to PubCommand to sign in with your own account and approve. Agents run through an API (Grok, the OpenAI or
          Claude API, scripts) use an API key from the Agents tab. Either way the AI usage is billed to that AI account, not to PubCommand.
        </p>
      </Step>
      <Step title="Claude (claude.ai, Claude Desktop, Claude Code)">
        <ol className="list-decimal space-y-1 pl-5">
          <li>In Claude, open Settings → Connectors and add a custom connector. On Team and Enterprise plans an owner may need to add it first.</li>
          <li>Paste the address above and connect.</li>
          <li>Claude opens PubCommand. Sign in, name the agent, and approve. It appears in the Agents tab as yours.</li>
        </ol>
        <p className="text-muted">Claude Code: <code className="font-mono text-xs">claude mcp add --transport http pubcommand {url}</code>, then run /mcp to sign in.</p>
      </Step>
      <Step title="ChatGPT and OpenAI agents">
        <ol className="list-decimal space-y-1 pl-5">
          <li>In ChatGPT, add a custom connector (app) with the address above, using OAuth sign-in. Some plans need developer mode turned on first.</li>
          <li>Sign in to PubCommand when asked and approve.</li>
        </ol>
        <p>With the OpenAI Responses API, add PubCommand as a remote MCP tool with an API key from the Agents tab:</p>
        <Code>{`"tools": [{
  "type": "mcp",
  "server_label": "pubcommand",
  "server_url": "${url}",
  "authorization": "pca_…",
  "require_approval": "never"
}]`}</Code>
      </Step>
      <Step title="Grok (xAI)">
        <p>Make an API key in the Agents tab (platform Grok). In the xAI API, add PubCommand as a remote MCP tool:</p>
        <Code>{`"tools": [{
  "type": "mcp",
  "server_label": "pubcommand",
  "server_url": "${url}",
  "authorization": "pca_…"
}]`}</Code>
        <p className="text-muted">Any client that can send an HTTP header works: send Authorization: Bearer pca_… to the address above.</p>
      </Step>
      <Step title="Claude API">
        <Code>{`"mcp_servers": [{
  "type": "url",
  "url": "${url}",
  "name": "pubcommand",
  "authorization_token": "pca_…"
}]`}</Code>
      </Step>
      <Step title="What agents can do">
        <ul className="space-y-1">
          {TOOLS.map(([name, help]) => (
            <li key={name}>
              <code className="font-mono text-xs font-semibold">{name}</code> <span className="text-muted">{help}</span>
            </li>
          ))}
        </ul>
        <p className="text-muted">Each tool checks the agent&apos;s own role and app access, the same way the app checks a person&apos;s. An agent with no Websites access does not see the Websites tools.</p>
      </Step>
    </div>
  );
}
