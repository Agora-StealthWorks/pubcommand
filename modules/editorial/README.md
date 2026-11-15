# Editorial

Issue list and one issue detail for a single organization. Route: `/editorial`. Detail: `/editorial?issue=<id>`.

| | |
| --- | --- |
| id / slug | `editorial` |
| Plan entitlement | `editorial` |
| Permissions | `editorial.read`, `editorial.write`, `editorial.publish` |
| Nav | `/editorial` (`editorial.read`) |

`editorial.read` sees issues and send stats. `editorial.write` can submit the writing-assist prompt. `editorial.publish` stays on the manifest for the module contract; this slice does not publish.

## Rows

Every issue stores `organizationId`, title, subject, status, body, schedule, and send stats: `opens`, `clicks`, and `revenue`. `listIssues` and `getIssue` return only rows for the organization you pass.

## EXAMPLE seed

The first read for an organization writes three `EXAMPLE` issues (one sent, one scheduled, one draft). The sent issue carries sample opens, clicks, and revenue. These numbers are seed data, not a live send.

## Writing assist

On an issue, a viewer with `editorial.write` can submit a prompt. The panel calls `@pubcommand/ai` when that package resolves, and otherwise calls the workspace AI package in this repo. Phase 1's provider does not call the network; the panel shows that result. If neither load works, the panel shows a TODO. The assist does not write the issue body yet.

## TODO: ESP sync

`syncSendStatsFromEsp` and the `editorial.esp.sync` job are placeholders. Opens, clicks, and revenue still need a real email-service sync per issue and organization.

## UI

`apps/web/src/app/sites/org/[slug]/editorial/page.tsx` renders `renderEditorialPage` at `/editorial`, so the org host does not use the foundation placeholder. Detail is `/editorial?issue=<id>`. A prompt is `prompt` on that same query. The page checks the `editorial` plan entitlement and an editorial permission before rendering. `canWrite` follows `editorial.write`.

## Tests

The modules package test script includes this folder. From the repo root:

```
pnpm --filter @pubcommand/modules test
```

To run only these tests, from `modules/`:

```
pnpm exec vitest run --config editorial/vitest.config.ts
```
