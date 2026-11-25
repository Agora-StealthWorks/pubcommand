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
`get_website_post`, `create_website_post`, `update_website_post`), Mini-Blog
(`list_miniblogs`, `list_miniblog_posts`, `get_miniblog_post`, `create_miniblog_post`,
`update_miniblog_post`) and the Brain (`search_brain`, `read_brain_note`, `list_brain_notes`,
`save_brain_note`).

The Brain tools see what a person of that brand sees: the brand's notes and other brands'
SHARED notes (`modules/knowledge/visibility.ts`). They need `knowledge.read`, and `save_brain_note`
also needs `knowledge.write`. Saved notes are private to the brand, carry source `ai-agent`, and
learn up into the Master Brain like any taught note. An agent can update only notes it saved
itself. No tool calls PubCommand's LLM: the agent's own AI reads the search results. An app's tools are listed only when the app is on and the agent can
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

## Platform agents (super admins only)

A SUPER_ADMIN can add **platform agents** in the admin console under **AI Agents**
(`admin.<root>/agents`). The same page lists every organization's agents with their calls and
errors from the last 24 hours. A platform agent connects to the console host's MCP server,
`admin.<root>/api/mcp`, by OAuth (the consent screen is `/agents/connect` in the console) or
with a `pca_` key.

- **Storage.** It is an `ai_agents` row with `scope = "platform"`, stored under the console
  organization (`pubcommand-console`), so tokens, activity, OAuth codes and rate limits reuse the
  agent tables. It has no membership and takes no seat anywhere.
- **Gatekeeping.** Only an active SUPER_ADMIN (with a ready 2FA session when required) can add,
  connect or change one. It stops working as soon as its owner is not an active SUPER_ADMIN. A
  platform token is invalid on organization hosts, and an organization token is invalid on the
  admin host. The admin host middleware lets only `/api/mcp`, `/api/oauth/*` and the OAuth
  discovery documents through without a staff session.
- **Tools** (`features/agents/platform-tools.ts`):
  - Master Brain: `search_master_brain`, `read_master_note`, `list_master_brain`,
    `save_master_note`.
  - Any organization's Brain: `search_brain`, `read_brain_note` and `list_brain_notes` with
    `organization`.
  - Monitoring: `platform_overview`, `list_organizations`, `get_organization`, `list_users`,
    `platform_audit_log`, `organization_audit_log`, `list_job_runs`, `ai_usage`,
    `list_ai_agents`.
  - Usage (see `docs/USAGE.md`): `usage_overview`, `usage_apps`, `usage_people`, `user_usage`,
    `usage_activity` (what people made, with copy snapshots) and `server_health`.
  - Operations Brain: `search_operations_brain`, `list_operations_brain`,
    `read_operations_note`, `save_operations_note`.
  - Admin changes, only when the agent's **Can make admin changes** is on (default on, can be
    switched off per agent): `suspend_organization` (and resume), `change_organization_plan`,
    `set_organization_app_access`, `add_organization_member` and `run_job`. Each one needs a
    `reason` and is written to the platform audit log under the agent's name.
  - Deliberately left out: deleting or purging anything, passwords, 2FA, impersonation, staff
    changes and domains.
