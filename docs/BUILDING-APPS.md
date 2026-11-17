# Building a PubCommand app

How every app (module) in PubCommand is built. Read this before you change anything.

## The product, today

- PubCommand replaces Stephen's old OxfordHub suite of internal tools with one app.
- **One team uses it for now.** Several teams later. Do not build selling features (billing, plans, signup).
- Inside a workspace, **brands are publishers** (MTA is the first, used as the sandbox). **Not finance-specific:** a brand has a `niche` (finance, health, general), an `audience` and `complianceNotes`. Build every prompt from `brandPromptContext(brandProfile(ctx.brand))` (`@pubcommand/core`) and never hardcode an investing reader, stocks or finance-only rules unless the app is finance-only. The sidebar has a brand switcher. App data belongs to the current brand (`ctx.brand`), unless the app says otherwise.
- **Brain:** each brand has a mini-brain; the main Brain is `brandId = null`. Apps teach the Brain through `teachBrain()` (below).
- Light theme: white cards (`rounded-xl border border-line bg-white`) on `bg-canvas`, one blue accent (`text-accent` / `bg-accent`), muted text `text-muted`. No dark theme.
- Must work on a phone at 375px wide with no sideways scroll.

## The old apps are the spec, never the source

The old OxfordHub repos are cloned read-only under `/home/user/<repo>` and `/home/user/stephenpriorhub/<repo>`. Rebuild guides are in `/tmp/claude-0/-home-user-pubcommand/2f38f604-3785-5968-8af3-a4de371820cf/scratchpad/handoff/pubcommand-handoff/oxfordhub-apps/`.

- Read them to learn **what the app did and how people used it**: screens, fields, workflows, rules.
- **Do not copy code, and do not copy prompts verbatim.** Write new code and new prompts. The old apps were built for a former employer.
- Do not import former-employer data except where your brief says so.
- Do not call the old apps' services (`oxfordhub.app`, `brain.oxfordhub.app`, `HUB_API_TOKEN`). PubCommand has its own login, database and Brain.

## Where things go

Follow **Promo Analyzer** as the reference implementation:

| What | Where | Reference |
| --- | --- | --- |
| Manifest (name, nav, permissions) | `modules/<id>/manifest.ts` | `modules/promo-studio/manifest.ts` |
| Pure logic, AI prompts, JSON schemas, calculations (unit tested, no DB) | `modules/<id>/*.ts` + `*.test.ts` | `modules/promo-studio/analysis.ts` |
| Server code: DB reads/writes, AI calls, background runs | `apps/web/src/features/<app>/` | `apps/web/src/features/promos/` |
| Server actions (`"use server"`) | `apps/web/src/features/<app>/actions.ts` | `features/promos/actions.ts` |
| Pages | `apps/web/src/app/sites/org/[slug]/<route>/` | `.../promo-studio/` |
| Downloads / exports | `route.ts` under the page folder | `.../promo-studio/[promoId]/export/route.ts` |
| Tables | `packages/db/prisma/schema/<app>.prisma` | `promo-analyzer.prisma` |

The route stays the module's existing slug (e.g. `/editorial`, `/charts`). Import module code by relative path, as the promo pages do.

## Rules for every page and action

- Load context with `getOrgContext(slug)` (`@/lib/org`). Check `ctx.subject.entitledModuleIds.includes("<id>")` and `can(ctx.subject, "<perm>", ctx.scope)` on **every** page, server action and route handler. A layout check does not protect actions or routes.
- Read and write tenant data only through `tenantDb(ctx.resolved.id)`. It supports `findMany`, `findFirst`, `findUnique`, `count`, `create`, `updateMany`, `deleteMany` (no `update`, `upsert`, `createMany`). Always pass `organizationId` in `create`.
- Audit every change with `appendOrgAudit`.
- Use `Flash`, `PageHeader`, `Denied` from `@/components/ui` and `Button`, `Input`, `Label`, `Textarea`, `Badge`, `Card` from `@pubcommand/ui`. Selects use `className="pc-control"`. Wide tables go in `TableScroll` (`@/components/table-scroll`).
- Long work (AI, imports) runs after the response with `after()` from `next/server`, with a status column the page polls (see `AutoRefresh` in `features/promos/auto-refresh.tsx`).
- Files are stored in Postgres `Bytes` columns (see `PromoFile`). There is no volume.

## Database

- Put your models in **your own file** `packages/db/prisma/schema/<app>.prisma`. Do **not** edit `schema.prisma` or other apps' files.
- Do **not** add relation fields to `Organization`, `Brand` or `User` (that edits shared files and causes merge conflicts). Use plain columns: `organizationId String @map("organization_id") @db.Uuid`, `brandId String? @map("brand_id") @db.Uuid`. Add the foreign keys by hand in your migration SQL, with `ON DELETE CASCADE`. Relations between your own models are fine.
- Every tenant table has `organization_id`. The tenant client picks up any model with an `organizationId` field automatically.
- Use `@@map("snake_case")` and `@map` on columns, like the existing tables.
- Create the migration against **your own local database only**: `cd packages/db && npx prisma migrate dev --create-only --name <app>_<what>`. Then append the RLS block below and apply with `npx prisma migrate deploy`. Migrations must be additive: no `DROP`, no type changes to existing columns.

```sql
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['your_table', 'your_other_table']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (public.bypass_rls() OR organization_id = public.current_org_id()) WITH CHECK (public.bypass_rls() OR organization_id = public.current_org_id())', table_name);
  END LOOP;
END $$;
```

- Never point any Prisma command at a Railway or production database. Never use `--shadow-database-url` at anything but a local scratch database.

## AI

- `runStructured<T>({ system, input, schema, effort })` returns JSON matching a JSON Schema; `runText({ system, prompt })` returns prose. Both are in `@pubcommand/ai`, never throw, and return `status: "unavailable"` when `ANTHROPIC_API_KEY` is not set. Show that reason to the user; do not fake output.
- Schemas: every object needs `additionalProperties: false` and every property listed in `required`. Use `anyOf: [{type:"number"},{type:"null"}]` for nullable numbers.
- Log every call with `logAiUsage()` from `apps/web/src/features/ai/usage.ts`.
- **The AI never supplies facts.** Prices, gains, chart numbers and stats come from data or from people. AI drafts, summarizes, classifies and critiques.
- There is no API key in this container. Test the "unavailable" path, and test rendering by inserting a realistic sample result directly into your local database.

## Brain

`teachBrain()` in `apps/web/src/features/brain/teach.ts` writes or refreshes one note. Use a stable `sourceRef` such as `"calendar-issue:<id>"` so re-saving updates the note instead of duplicating it. Teach the brand's mini-brain (`brandId: ctx.brand.id`). Only use `visibility: "SHARED"` for generic best practices.

## Things you must not edit

These are shared and edited only by the lead, to avoid conflicts:

- `apps/web/src/lib/apps.ts` (dashboard cards and sidebar), `apps/web/src/components/app-thumbnail.tsx`, `org-shell.tsx`, `app-frame.tsx`
- `packages/db/prisma/schema/schema.prisma` and other apps' schema files, `packages/db/src/tenant.ts`
- `packages/ai/src/index.ts`, `features/ai/*`, `features/brain/teach.ts`
- Other apps' folders

If you need a change in one of these, say so in your final report with the exact change.

Adding an npm dependency is fine: `pnpm --filter @pubcommand/web add <pkg>`. Mention it in your report.

## Running and checking your work

Your brief gives you a worktree path, a local database name and a port.

```bash
cd <worktree>
pnpm install
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/<your_db>
export AUTH_SECRET=local-dev-secret-at-least-16-chars ROOT_DOMAIN=localhost AUTH_DEV_EXPOSE_LINKS=true
pnpm db:generate
(cd packages/db && npx prisma migrate deploy)
pnpm --filter @pubcommand/web exec next dev -p <port>      # run in the background
```

If Postgres is down: `su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/tmp/pcpg -l /var/tmp/pcpg/log -o '-k /tmp -c listen_addresses=localhost' start"`.

Your database is already seeded. Sign in at `http://example-gazette.localhost:<port>/login` with the **password** form (`#password-email`, `#password`): `stephen@onenationfinancial.com` / `localtest123` (local only). Then use `http://example-gazette.localhost:<port>/<route>`. Playwright is preinstalled (`require('playwright')`). Playwright's `page.request` cannot resolve `*.localhost`; fetch inside the page with `page.evaluate` instead.

Before you finish:

- `pnpm typecheck`, `pnpm lint`, and `pnpm test` (with `DATABASE_URL` set) all pass.
- Unit tests for your pure logic in `modules/<id>/*.test.ts`.
- Screenshots at 1360px and 375px of each main screen; at 375px `document.documentElement.scrollWidth` must be 375.
- Commit to your branch in your worktree with a clear message. **Do not push. Do not touch `main`.**

## Scheduled jobs

Background work that runs on a schedule (syncs, reminders, digests, cleanups) is a job:

1. Create `apps/web/src/jobs/<app>-<what>.ts` exporting `defineJob({ name, description, schedule, run })` (`@/lib/jobs/types`). `schedule` is a 5-field cron expression in America/New_York unless `timeZone` is set. Name jobs `<module>.<what>`, e.g. `intel.gmail-sync`.
2. Add it to the `JOBS` array in `apps/web/src/jobs/index.ts` (one import, one entry, keep sorted).
3. `run` must be idempotent and work across organizations: list org ids with `rawPrisma()`, then do every tenant read/write through `tenantDb(orgId)`. Return a small JSON summary (counts only, never PII).

Each slot runs once across all servers; failures are retried at the next slot; platform staff see every job and its runs in Admin → Jobs and can "Run now". Do not add `setInterval` loops or new cron HTTP routes for scheduled work.

## Email

`sendEmail({ to, subject, html, text })` in `apps/web/src/lib/email.ts` sends through Resend when `RESEND_API_KEY` is set and returns `{ status: "logged" }` otherwise; show "email is not set up yet" in the UI in that case. `escapeHtml()` is there too. Only email people who expect it (reviewers someone named, the team, subscribers who opted in).

## Web research in AI calls

`runStructured({ ..., webSearch: { maxUses: 5 } })` lets the model search the web. When you use it, the prompt must ask for a source URL next to every fact, and the UI must show those sources.

## Brain visibility (updated)

The **main Brain is for PubCommand platform staff only** (Admin console). Organizations and brands never see it, never see a "main Brain" switch, and are never told their notes train it. Apps teach the brand's mini-brain with `teachBrain()`; propagation to the main Brain happens inside the Brain module. Best practices that flow down appear in a brand's Brain as ordinary notes.
