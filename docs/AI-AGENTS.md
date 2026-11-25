# AI Agents

Claude, Grok, OpenAI and other agents can work inside an organization as members: they read
and write posts through PubCommand's MCP server. The sidebar's **AI Agents** section manages them.

## The model

- **An agent is a member of one organization.** It has its own `users` row (email
  `agent-…@agents.pubcommand.invalid`, no password), an ACTIVE membership with a role, and an
  `ai_agents` row naming its **owner** (a person in the organization) and its **platform**.
- **Same permission system as people.** It starts with its owner's role. Narrow it or add
  access in Settings → Users like for anyone (role, per-app access, exclusions).
- **No seat.** Seat counts skip agent users (`occupyingSeats` in `packages/db/src/provision.ts`
  and the billing and console counts).
- **No browser sign-in.** `establishSession` refuses agent users. `readSession` ignores them, and
  magic links, password resets, admin-set passwords and invites to the reserved domain are refused.
- **One organization only.** The organization comes from the host the agent calls
  (`<org>.pubcommand.com/api/mcp`). The token is looked up with `tenantDb(thatOrg)`, so another
  organization's token is simply "not valid".
- **Owner leaves, agent stops.** A request is refused unless the owner is still an active member.
- **AI usage is the owner's.** Agents run on their own Claude, Grok or OpenAI account. PubCommand
  only serves the tools and never calls an LLM for them. Publishing a Mini-Blog post still runs
  the usual Brain/Calendar hooks, the same as when a person publishes.

## Connecting

The MCP server is `POST /api/mcp`: Streamable HTTP, stateless, JSON responses. Code:
`apps/web/src/features/agents/mcp.ts` and `tools.ts`.

- **OAuth (Claude and ChatGPT connectors).** The connector gets a 401 with
  `resource_metadata`, reads `/.well-known/oauth-protected-resource` and
  `/.well-known/oauth-authorization-server` (the middleware rewrites these to `/api/oauth/*` on
  organization hosts), and registers itself (`/api/oauth/register`). It then sends the person to
  `/agents/connect`, where they sign in with their PubCommand account and approve. The code is
  traded at `/api/oauth/token` with PKCE S256 for a 1-hour access token (`pcat_`) and a 60-day
  refresh token (`pcar_`), rotated on every use. A replayed code or a reused refresh token
  revokes that connection.
- **API key (Grok, the OpenAI/Claude APIs, scripts).** A `pca_` key is made in AI Agents and
  sent as `Authorization: Bearer pca_…`. It is shown once and stored as SHA-256.

## Tools

`whoami`, `list_brands`, Websites (`list_websites`, `list_editors`, `list_website_posts`,
`get_website_post`, `create_website_post`, `update_website_post`) and Mini-Blog
(`list_miniblogs`, `list_miniblog_posts`, `get_miniblog_post`, `create_miniblog_post`,
`update_miniblog_post`). An app's tools are listed only when the app is on and the agent can
read it. Each call checks the agent's permission in the post's brand.

Each tool call is logged in `ai_agent_calls` (the agent's Activity list, plus a limit of
120 calls a minute). Writes also go to the organization's audit log as the agent user.

## Publishing and approvals

**Allow publishing by AI agents** (AI Agents → Settings, `ai_agent_settings`, default on):

- **On:** an agent with publish rights publishes and schedules directly.
- **Off, or no publish right:** its publish becomes `pending`, and it cannot change live posts.

**Approvals** lists every pending Website and Mini-Blog post in the brands where the viewer can
publish. They can approve it (publish or schedule) or send it back to draft. Mini-Blog posts
gained the `pending` status for this, and they stay hidden publicly like drafts.

## Visibility

Agents are labelled only inside PubCommand: the agent list, Settings → Users, the post lists,
Approvals and Activity. Public pages and the websites JSON API show only a post's byline
(`authorName` or an editor profile), never who created it.

## Permissions

`agents.manage` (in the Settings manifest, admin) lets someone see and manage every agent and
change the publishing setting. Without it, a member manages only their own agents. Approving
needs `websites.publish` or `miniblog.publish` in the post's brand.
