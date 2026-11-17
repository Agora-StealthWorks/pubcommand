# Forms

Route `/forms`. Surveys and forms per brand: builder with branching, public links, embeds, results, exports and an AI summary.

Permissions: `forms.read` (see forms and aggregate results), `forms.write` (build, publish, themes, folders, AI summary), `forms.export` (see individual responses, download files, export CSV/XLSX, delete responses). Individual responses are PII, so they need `forms.export`. Keep these gates separate.

## Pure code (this folder, unit tested)

- `fields.ts`: the field registry. The ONE place a field type is defined; the palette, inspector, renderer, validator, exports and analytics all read it.
- `logic.ts`: the branching engine (show/hide from earlier answers, forward-only skip logic). Imported verbatim by the browser renderer and by the submit route, which recomputes visibility and the path from raw answers. A crafted POST cannot skip a required field by claiming it was hidden; answers to hidden fields are dropped.
- `theme.ts`: theme resolution (logo height, colours, privacy link), publish checks, schedule/limit, spam verdict, UTM and hidden-field capture.
- `poll.ts` (public live results: closed questions only, withheld below a minimum), `notify.ts` (team and respondent emails, digest timing), `pdf.ts` (dependency-free PDF writer, results and single-response reports), `mirror.ts` (encrypted credentials, Airtable/Sheets rows, retry backoff), `jobs.ts` (job selection logic).
- `analytics.ts`, `export.ts` (CSV with formula neutralizing, minimal XLSX via fflate), `summary.ts` (AI prompt/schema, Brain note, response deletion plan), `starters.ts` (niche-neutral starter forms).

## App code

- Server: `apps/web/src/features/forms/` (`actions.ts`, `data.ts`, `server.ts` for the AI summary, `public.ts` for anonymous submit/autosave).
- Admin pages: `apps/web/src/app/sites/org/[slug]/forms/` (list, `[formId]` builder, `[formId]/results`, `themes`, export and file routes).
- Public pages (no sign-in): `apps/web/src/app/sites/public/[slug]/f/[formSlug]` and `/embed/[formSlug]`. `middleware.ts` rewrites `/f/*` and `/embed/*` on an org host there, outside the org layout's login redirect.

## Notify, share, mirror, jobs

- Field types added: grids (one per row / checkboxes), ranking (drag with arrow-button fallback), slider, currency, image upload (type sniffed from bytes on the server), divider.
- Endings by answer (`Form.endRules`): `resolveEnding` runs in the submit route on the stored answers; the browser only shows what the server returns, and only follows http(s) URLs.
- `/forms/<id>/connect`: team notifications (each or daily digest; answers only to recipients holding forms.export), respondent confirmation (author text only, never answers), public results at `/f/<slug>/results`, one-way mirror to the author's Airtable or Google Sheet (needs forms.export; credentials AES-GCM encrypted with AUTH_SECRET; only column names are read from the destination).
- Jobs (`apps/web/src/jobs/forms-*.ts`): `forms.schedule` (5 min), `forms.notification-digest` (hourly), `forms.mirror-retry` (15 min), `forms.orphan-cleanup` (daily).
- PDFs: `/forms/<id>/report` (aggregates, forms.read) and `/forms/<id>/responses/<rid>/pdf` (forms.export).

## Rules worth keeping

- Both renderer actions are `type="button"` with distinct keys (never one node flipping to submit mid-click). Enter never submits natively.
- The builder's `DndContext` uses `restrictToVerticalAxis` only. Never `restrictToParentElement`, which silently disables reordering.
- Auto-advance is armed in `setAnswer`, never in an effect (an effect re-fires on Back).
- The privacy-policy link is always rendered and a form cannot be published without a theme that has one. The header is the theme logo, or the brand name when there is none.
- Spam (honeypot, too-fast) is flagged and kept, never discarded.
- Deleting responses takes an explicit scope; "all" needs the form title typed back.
- The AI and the Brain (`teachBrain`, sourceRef `form:<id>`) get aggregates only. Free values shared by fewer than 3 people are left out.
