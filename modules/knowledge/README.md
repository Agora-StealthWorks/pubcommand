# Knowledge

Markdown pages for one organization, at `https://{org}.{ROOT_DOMAIN}/knowledge`.

The shell already registers this manifest (`id`, `slug`, and `planEntitlement` are `knowledge`). Nav is `/knowledge`. Permissions are `knowledge.read` and `knowledge.write`. Saving a page records the `knowledge.entry.saved` event. The `knowledge.reindex` job stays declared for a later index.

## This slice

- Create and list markdown pages scoped by `organizationId`.
- Keyword search over the title and body. Every word must match.
- Results use a citation shape: `pageId`, `organizationId`, `title`, `slug`, `excerpt`, `href`.
- `can()` from `@pubcommand/core` gates read and write. The route calls `canReadKnowledge` and `canWriteKnowledge`.
- The first read for an organization copies fake **EXAMPLE** pages into that organization. Those rows are labeled `EXAMPLE:` and are not shared with other organizations.

Pages are held in process memory, keyed by `organizationId`. A tenant table is the next persistence step.

## Route

`apps/web/src/app/sites/org/[slug]/knowledge/page.tsx` mounts this module on the organization host. The page checks the plan entitlement and `can()` before it lists, searches, or creates.

## Later

- PDF and docx ingestion.
- pgvector semantic search.
- AI chat over citations.
- A Postgres tenant table with `organization_id`, plus the `knowledge.reindex` job.
