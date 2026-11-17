# Brain (`knowledge`)

Each publisher brand has a **mini-brain** (notes with that `brandId`); the **main Brain** is `brandId = null`. Route: `/knowledge`.

## Visibility (the one rule: `visibility.ts`, SQL twin in `apps/web/src/features/brain/search.ts`)
- Main Brain view: every live note in the organization (learning flows up). Only members not tied to one brand or workspace may open it (`canUseMainBrain`).
- A brand's mini-brain: its own notes + notes marked `SHARED` (from any brand or the main Brain). Nothing private from another brand or the main Brain.
- Edits stay in the note's own Brain (`canEditNoteInScope`). Sharing needs `knowledge.write` + `knowledge.share`.

## Pure code here (unit tested)
- `wikilinks.ts`: `[[Title#heading|alias]]` parsing (code ignored), title matching, resolver that prefers the scope's own brand.
- `secrets.ts`: credential detection (reports kind + line, never the value).
- `vault.ts`: importer rules, MTA export rules, front matter/tags, the idempotent import plan (`sourceRef = vault:<path>`; a note already in another Brain is never moved).
- `zip.ts`: in-memory zip read/write (fflate). Only `.md` entries are inflated.
- `ask.ts`: Ask the Brain prompt, JSON schema and citation clean-up.
- `folders.ts`: folder tree.

## Server + pages
`apps/web/src/features/brain/*` and `apps/web/src/app/sites/org/[slug]/knowledge/**`.

## Building a vault zip
`pnpm --filter @pubcommand/modules exec tsx ../scripts/build-vault-zip.ts <vault dir> <out.zip>` writes the zip and `<out>.manifest.json`.
