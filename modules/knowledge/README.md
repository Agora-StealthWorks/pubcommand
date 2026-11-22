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

## Conflicts (Publication Setup vs the main Brain)
Console page `/brain/conflicts` (`platform.brain.manage`). Publication Setup facts are the source of truth; the page lists every main-Brain statement that contradicts them.
- **Detection** (`conflicts.ts`, pure): facts are rebuilt from the rows with `publicationFacts()`/`editorFacts()` (`features/brain-conflicts/entities.ts`); notes come from `listMainBrainNotesByEntity(name, { aliases: [code] })`, minus notes marked outdated and notes learned from another organization or brand. Rule layer: extractors for name/code, editor ↔ publication, prices (with term), frequency, launch date, editor title, status. AI layer (`runStructured`, `CONFLICT_SCHEMA`): facts + top 6 notes; a returned quote must really be in the note or it is dropped. Without a key only the rules run and the page says so.
- **Storage** (`brain-conflicts.prisma`, migration `20261117130100_brain_conflicts`): `main_brain_conflict_checks` (one per entity: facts/notes hashes, AI status and usage), `main_brain_conflicts` (one per entity × fact × note; status OPEN/RESOLVED/DISMISSED, resolution, who, when), `main_brain_note_flags` (outdated notes). No `organization_id` (provenance is `entity_organization_id`), RLS `bypass_rls()` only.
- **When**: job `knowledge.conflict-check` (hourly) re-checks entities whose facts hash or matching-notes hash changed; "Re-check now" per entity, "Re-check what changed" / "Re-check everything" on the page.
- **Decisions are sticky**: a dismissed or resolved conflict returns only when the fact or the note text changed (`reconcileConflicts`). One the re-check cleared itself returns as soon as it is found again.
- **Rectify**: correct the passage inline, or an AI rewrite of the note a person reviews and saves (both set `editedAt`, re-sync push-down, re-check); mark the note outdated (kept, flagged on its page, skipped by Ask and checks; restorable); dismiss with a reason; or "Setup is wrong": a link to the entity in the org's Publication Setup plus the existing impersonation form. The console never edits org data.
- **AI usage**: console checks belong to no organization, so like main-Brain Ask they are not written to an org's usage log; usage is stored on `main_brain_conflict_checks.ai_usage` and logged to the server log.

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

## Admin console: Promo Analyzer, VidRipper, BrainChat, Past data
Platform staff with `platform.brain.manage` get four more console entries on `admin.<root>`.

- **Console workspace.** Promo Analyzer (`/promo-studio`) and VidRipper (`/intel/videos`) run the org apps' own pages and actions inside one internal organization, `pubcommand-console` (`apps/web/src/lib/console-workspace.ts`, created on first use, nobody is a member, staff override ALLOWED for promo-studio/intel/knowledge/pubsetup). `getOrgContext()` returns a staff context for that slug on the admin host; guards use `requestOrgSlug()` instead of `request.site.slug`. The console routes under `app/sites/admin/promo-studio` and `app/sites/admin/intel/videos` are thin wrappers that add the slug (`lib/console-params.ts`). Everything the console analyzes or captures teaches that workspace's brand Brain and learns up like any other organization.
- **Always feeds the Master Brain.** Promo Analyzer teaches after every run (`teachBrain` → `learnUp`). Job `knowledge.promo-sync` (hourly) fills any promo, in any organization including deleted ones, whose review or copy is missing (`syncPromosToMasterBrain`, notes built by `modules/promo-studio/master-brain.ts`, same sourceRefs as the analyzer).
- **Past data** (`/brain/past`). "Bring it over" = learn-up for every organization (deleted included) + the promo sync + copy promos (with analyses and files) and videos (with transcript, extraction, keyframes) into the console workspace in batches (`promos.copied_from_id`, `intel_videos.copied_from_id`; originals untouched; idempotent). Lists the Master Brain's promo reviews and video captures; for videos whose organization is gone, that note is the only record.
- **BrainChat** (`/brain/chat`). Per-staff chats (`main_brain_chats`, `main_brain_chat_messages`, platform-only RLS). Each turn runs `runChat()` (`packages/ai/src/chat.ts`: manual tool loop on the Messages API, streaming, eager tool input checked against the schema) with tools `search_brain`, `read_note`, `list_brain`, `save_note` (`modules/knowledge/brain-chat.ts`). Answers stream into the message row; the page refreshes while it runs. Uploaded files (docx, pdf, txt, md, csv, json, html) become Master Brain notes (folder "BrainChat uploads", original attached when allowed) before the turn; scanned PDFs are also sent to the model as documents. `save_note` writes AUTHORED notes (source `brainchat`) or updates one (sets `editedAt`, re-syncs push-down). Usage is logged to the server log, like main-Brain Ask.
