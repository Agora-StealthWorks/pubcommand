# Brain (`knowledge`)

Two layers, strictly separated:

| | Brand Brain (org app) | Main Brain (admin console) |
| --- | --- | --- |
| Who sees it | members of the organization, one brand at a time | PubCommand staff with `platform.brain.manage` (SUPER_ADMIN, OPS) |
| Where | `/knowledge` on the org host | `/brain` on `admin.<root>` |
| Storage | `knowledge_pages` (+ `knowledge_attachments`, `knowledge_questions`, `knowledge_imports`), tenant tables with RLS | `main_brain_notes`, `main_brain_attachments`, `main_brain_push_targets`, `main_brain_questions`, `main_brain_imports` |
| Tenancy | `organization_id` + `brand_id` | none: no `organization_id` column, RLS allows only `app.bypass_rls` |

An organization never sees the main Brain, never sees a switch to it, and is never told its notes train it.

## Why separate platform tables
- `tenantDb()` only exposes models that have an `organizationId` field. The main-Brain models have none (provenance columns are named `originOrganizationId` / `originBrandId`), so org code cannot even query them: it throws.
- RLS on the main-Brain tables is `USING (bypass_rls())`: an org context (`app.current_org_id`) sees zero rows even through raw SQL. Console code goes through `mainBrain(tx => …)` in `apps/web/src/features/main-brain/db.ts`, which sets `app.bypass_rls` for one transaction.
- Search over the main Brain has its own GIN index (`main_brain_notes.search_vector`); brand search SQL (`features/brain/search.ts`) only ever reads `knowledge_pages`.

## Brand visibility (`visibility.ts`, SQL twin in `features/brain/search.ts`)
- A brand sees its own notes plus notes another brand of the same organization marked `SHARED`.
- Rows with `brand_id IS NULL` (the old organization-level "main Brain") are never visible. They were copied to `main_brain_notes` by migration `20261117123153_brain_main_brain_platform`, then marked (`moved_to_main_at`, visibility `PRIVATE`, `source_ref` prefixed `legacy:`). Nothing was deleted; the copy keeps the original visibility in `origin_meta` and the original sourceRef in `origin_source_ref`.
- Best practices pushed down from the console are ordinary notes in the brand's own Brain: `source = "best-practices"`, folder "Best practices", read-only (`canEditNoteInScope` is false), never visible to other brands even if `SHARED`.

## Learning up
`teachBrain()` (`features/brain/teach.ts`, signature unchanged) writes the brand note, then calls `learnUp()` (`features/main-brain/learn.ts`): one main-Brain note per `learned:<orgId>:<sourceRef>` with provenance (organization, brand, app = `source`, `sourceRef`, brand note id). `brandId: null` writes the main Brain only. Rules (`main-brain.ts#learnAction`): a staff edit in the console (`editedAt`) wins over later app writes; a staff delete is never undone. Member notes, vault imports and pushed copies never learn up. Job `knowledge.learn-up` (hourly) back-fills anything taught before this existed or whose copy failed.

## Push down
On a main-Brain note page staff choose Not pushed / All brands / chosen brands. `syncPushDown()` (`features/main-brain/push.ts`) materializes, updates or withdraws (soft-deletes) the brand copies, including attachments; sourceRef `best-practices:<mainNoteId>:<brandId>`. Job `knowledge.push-down` (hourly) keeps "all brands" current as brands are added.

## Conflict-review hook (for the next agent)
`listMainBrainNotesByEntity(name, { aliases?, limit? })` in `apps/web/src/features/main-brain/notes.ts` returns live main-Brain notes about one publication or editor name, strongest first (`strength` 3 = title is the name, 2 = title starts with it, e.g. "Name — Facts", 1 = whole-phrase mention in title or body), with provenance columns. Pass a publication code as an alias. Platform staff only; never call it from org code. A conflict-review page can compare each Publication Setup fact with these notes.

## Pure code here (unit tested)
- `visibility.ts`: the brand rule, best-practice marker, labels.
- `main-brain.ts`: keys, learn-up decision, push targets and plan, provenance text, entity matching.
- `classify.ts`: deterministic vault split (brand vs general) with the rule and evidence per note.
- `graph.ts`: notes + resolved `[[links]]` → nodes/edges, deterministic force layout (server side; client only pans/zooms).
- `attachments.ts`: allowed types (type from extension, image magic bytes checked, SVG never inline), headers (`nosniff`, sandbox CSP), `![[file]]` lookup.
- `wikilinks.ts`, `secrets.ts`, `vault.ts`, `zip.ts`, `ask.ts`, `folders.ts` as before.

## Attachments
Bytes in Postgres (`knowledge_attachments`, `main_brain_attachments`). Served by `/knowledge/files/<id>` (same checks as the note page; the note must be visible in the current brand) and `/brain/files/<id>` (console, `platform.brain.manage`). `![[file.png]]` in a note renders the image.

## Ask history
Questions are saved per person: brand Brain `knowledge_questions.created_by_id` (a question only opens for its asker), console `main_brain_questions.asked_by_id`. Star (`saved_at`) and remove from history (`hidden_at`, kept for audit). Console Ask usage is not written to any organization's AI usage log.

## Meaning-based search
Not built. Without pgvector and without an embeddings API key the only option is a local embedding model (ONNX weights of tens of MB downloaded at runtime plus native onnxruntime in the Docker image) with vectors in `bytea` and cosine in Node. That is a deployment change, so search stays Postgres full-text (with title boost and OR-ranking for Ask).

## Vault zips
- `scripts/build-vault-zip.ts <vault> <out.zip>`: one zip with the approved exclusions.
- `scripts/build-brain-split.ts <vault> <out dir> --wiki <mta-wiki> --mtarix <mtarix>`: `mta-mini-brain.zip` (import in the org app, MTA brand) + `main-brain.zip` (import in the console) + `brain-split.manifest.{json,csv}`. Rules in `scripts/brain-split.mta.json`; editor and publication names are read from the wiki/MTARIX at build time.

Run either with `pnpm --filter @pubcommand/modules exec tsx ../scripts/<script>.ts …`.
