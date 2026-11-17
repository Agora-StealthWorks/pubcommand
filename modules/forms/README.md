# Forms

Route `/forms`. Surveys and forms per brand: builder with branching, public links, embeds, results, exports and an AI summary.

Permissions: `forms.read` (see forms and aggregate results), `forms.write` (build, publish, themes, folders, AI summary), `forms.export` (see individual responses, download files, export CSV/XLSX, delete responses). Individual responses are PII, so they need `forms.export`. Keep these gates separate.

## Pure code (this folder, unit tested)

- `fields.ts`: the field registry. The ONE place a field type is defined; the palette, inspector, renderer, validator, exports and analytics all read it.
- `logic.ts`: the branching engine (show/hide from earlier answers, forward-only skip logic). Imported verbatim by the browser renderer and by the submit route, which recomputes visibility and the path from raw answers. A crafted POST cannot skip a required field by claiming it was hidden; answers to hidden fields are dropped.
- `theme.ts`: theme resolution (logo height, colours, privacy link), publish checks, schedule/limit, spam verdict, UTM and hidden-field capture.
- `analytics.ts`, `export.ts` (CSV with formula neutralizing, minimal XLSX via fflate), `summary.ts` (AI prompt/schema, Brain note, response deletion plan), `starters.ts` (niche-neutral starter forms).

## App code

- Server: `apps/web/src/features/forms/` (`actions.ts`, `data.ts`, `server.ts` for the AI summary, `public.ts` for anonymous submit/autosave).
- Admin pages: `apps/web/src/app/sites/org/[slug]/forms/` (list, `[formId]` builder, `[formId]/results`, `themes`, export and file routes).
- Public pages (no sign-in): `apps/web/src/app/sites/public/[slug]/f/[formSlug]` and `/embed/[formSlug]`. `middleware.ts` rewrites `/f/*` and `/embed/*` on an org host there, outside the org layout's login redirect.

## Rules worth keeping

- Both renderer actions are `type="button"` with distinct keys (never one node flipping to submit mid-click). Enter never submits natively.
- The builder's `DndContext` uses `restrictToVerticalAxis` only. Never `restrictToParentElement`, which silently disables reordering.
- Auto-advance is armed in `setAnswer`, never in an effect (an effect re-fires on Back).
- The privacy-policy link is always rendered and a form cannot be published without a theme that has one. The header is the theme logo, or the brand name when there is none.
- Spam (honeypot, too-fast) is flagged and kept, never discarded.
- Deleting responses takes an explicit scope; "all" needs the form title typed back.
- The AI and the Brain (`teachBrain`, sourceRef `form:<id>`) get aggregates only. Free values shared by fewer than 3 people are left out.
