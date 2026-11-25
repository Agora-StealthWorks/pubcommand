# PubCommand: rules for Claude Code and every coding agent

## Keep the Brain's knowledge of the app current (required)

The admin console's **Master Brain → Operations → How PubCommand works** is built from this
repository's documentation, and the Brain, BrainChat and the platform AI agents rely on it to
know what the app does today. It is synced on every boot and every night
(`apps/web/src/features/usage/reference.ts`). So **every change that adds, removes or changes
functionality must update the matching doc in the same commit**:

| What changed | Update |
| --- | --- |
| An app (forms, funnels, promo analyzer, mini-blog, websites…) | `modules/<app>/README.md` (create one if the app has none) |
| Platform: tenancy, permissions, hosts, auth, sessions, jobs, storage | `docs/ARCHITECTURE.md` (and `docs/MODULES.md` / `docs/BUILDING-APPS.md` when relevant) |
| AI agents, MCP tools | `docs/AI-AGENTS.md` |
| Usage tracking, the Usage page, the Operations Brain | `docs/USAGE.md` |
| Deploy, environment variables | `DEPLOY.md` |
| A new doc topic | a new `docs/<TOPIC>.md` (it is picked up automatically under Platform) |

Write docs as the current state of the product, in plain language: what it does, where it is,
who can use it, and the rules it follows. Not a changelog. The first `# heading` becomes the
note's title. A new `modules/<app>/README.md` appears under **Apps** without any other change.

## Log what people do

Every create, change, publish or delete in an app must call `appendOrgAudit()` (organization
actions) or `appendPlatformAudit()` (console actions) with a real `targetType` (the table name in
singular, e.g. `form`, `text_post`) and `targetId`. That is what the Usage page, the activity
feed and the Operations Brain learn from (`docs/USAGE.md`). Never put secrets or people's contact
details in audit metadata.

## Basics

- Layout, commands and local setup: `README.md`. Architecture: `docs/ARCHITECTURE.md`. Adding an app: `docs/BUILDING-APPS.md`.
- Before committing: `pnpm lint`, `pnpm typecheck`, `pnpm test` (DB tests need the local Postgres from `README.md`).
- Database changes need a migration in `packages/db/prisma/schema/migrations/`.
