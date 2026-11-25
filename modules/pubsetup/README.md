# Publication Setup

Route `/settings/publication-setup` (module id and slug `pubsetup`; `/pubsetup` redirects). **Admins only.**

The one place a publisher records each publication, its editors and its branding. Every other app reads it; the Brain learns from it; the wiki only displays it.

## Access

- One permission, `pubsetup.manage`, given to the `owner` and `admin` roles (migration `20261117070000_pubsetup_publications_editors`, and new orgs through the registry). There is deliberately no read tier.
- `canManagePublications()` (`access.ts`) = plan entitles `pubsetup` **and** `can(…, "pubsetup.manage")`. Every page, action and route calls it (`features/pubsetup/guard.ts`).
- Other apps read publications through `apps/web/src/features/pubsetup/read.ts` under **their own** permission checks.

## AI agents

AI agents can manage publications and gurus (editors / experts) through the MCP tools
`publication_fields`, `list_publications`, `get_publication`, `create_publication`,
`update_publication`, `archive_publication`, `list_gurus`, `get_guru`, `create_guru`,
`update_guru`, `link_guru` and `unlink_guru` (`apps/web/src/features/agents/publication-tools.ts`).
An organization agent needs the same right as a person (`pubsetup.manage`) in the brand. A
platform agent works in any organization, and changes need its "Can make admin changes" switch.
Saves use the same rules as the settings pages (`apps/web/src/features/pubsetup/records.ts`:
required fields, unique codes and URL names, category checks, issue codes following a code
change, audit entries, Brain and website refresh). Logos, covers and photos are set on the
settings pages only.

## Data (models in `packages/db/prisma/schema/pubsetup.prisma`)

| Table | What |
| --- | --- |
| `calendar_publications` (model `CalendarPublication`) | Publications. The Calendar's table, moved here unchanged and extended with Publication Setup columns. |
| `pubsetup_editors` (`PubEditor`) | Editors / experts, photo as bytes. |
| `pubsetup_publication_editors` (`PubPublicationEditor`) | Who writes which publication, with a role (`lead`, `co-editor`, `contributor`, `analyst`, `guest`). Cascades with either side. |
| `pubsetup_brand_branding` (`PubBrandBranding`) | One row per brand: branding defaults publications inherit. |
| `pubsetup_categories` (`PubCategory`) | A brand's publication categories (name, order). `calendar_publications.category_id` points at one (`ON DELETE SET NULL`). |

## Categories (replace "Type")

- Publication Setup → **Categories**: add, rename, reorder (↑/↓), delete. Deleting a category in use asks whether to move its publications to another category or leave them uncategorized. Names are unique per brand, any case. Audited `pubsetup.category.*`.
- Each publication picks one category in its form (the "Type" select is gone). `pub_type` is kept untouched (additive policy) and still feeds the internal funnel rule, but no screen shows it any more: lists, detail, wiki and Brain notes show the category name.
- Migration `20261122120000_websites_members_categories` seeded one category per distinct Type each brand used (same name, old Type order) and filed each publication under it. Idempotent (`-- seed:begin/end` block, tested in `packages/db/src/pubsetup.test.ts`; `planCategorySeed()` is the pure mirror).
- Websites list publications grouped and ordered by category: category order, then the publication's order, then name (`groupByCategory()` in `categories.ts`). Wiki and Publication Setup lists keep the internal funnel grouping.
- Import: `"category": "<name>"` (created when missing, fill-only like every field; add `"category"` to `replace` to move publications). Legacy `"pubType"` is still read: stored in `pub_type`, and used as the category name when `category` is absent.
- "Questions and answers" (`faq`, pairs) shows as the FAQ on the website's publication page.

Why the calendar table: issues, send stats, Mini-Blog and the CUB/What's Working code all key on `calendar_publications` (by `brand_id` + `code`). Keeping the table, model name and every column means none of them change and no data moves; Publication Setup adds nullable or defaulted columns only. `slug` was backfilled from `code` (unique per brand, `-2` on a clash), `status` from `active`.

Rules:

- `active` stays the calendar's "show in pickers" flag: it is `false` for `status = retired` and for archived rows.
- Archive = `deleted_at` (soft delete). Archived publications drop out of pickers but old issues and stats keep them; restore puts them back. Nothing is hard-deleted.
- Changing a code updates `calendar_issues.publication_code` so issues stay attached (as the calendar did).
- Images (logos, cover, editor photo, brand logos) are `Bytes` columns. `/settings/publication-setup/image/<kind>/<id>` serves them to admins; other apps call `getImage()` and serve from their own route.
- Email branding (email header image, default sender name/email, email footer) was removed from the app on 2026-11-17. Its columns stay (additive-only policy) but nothing reads or writes them. Nothing outside Publication Setup ever read them (funnels, Mini-Blog, forms and Calendar CUB emails have their own settings).

## Logos: two slots

Each publication and the brand defaults have two logo slots, named by the background they sit on:

| Slot | Columns | Image kind | Use |
| --- | --- | --- | --- |
| light | `logo_*` (the original columns) | `pub-logo` / `brand-logo` | white pages, light headers (dark artwork) |
| dark | `logo_on_dark_*` | `pub-logo-dark` / `brand-logo-dark` | dark headers (light artwork) |

- "Upload a logo" is sorted by its artwork (`features/pubsetup/logo-tone.ts` rasterizes with resvg and `logos.ts#toneFromPixels` measures the visible pixels; an opaque image is judged by its own border). WebP cannot be decoded, so it goes to the light slot with a note. Admins can replace, remove or swap either slot.
- Logos uploaded before the slots existed have `logo_sorted = false`. The read API checks each once and moves a light logo into the dark slot (no migration needed).
- **Render logos only through `logoFor(owner, background, brandFallback?)`** (`logos.ts`): the matching slot, then the other slot, then the brand's. It returns the image kind and the slot used, so a caller can put an other-slot logo on a contrasting tile. Pick the background the spot really has (a white card is `"light"`; a header on the primary color is `contrastText(primary) === "#ffffff" ? "dark" : "light"`).

## Pure code (this folder, tested in `pubsetup.test.ts`)

- `fields.ts`: **the field list** for publications, editors and branding (key, label, kind, group, limits, options). Forms, validation (`parseFields`), facts and Brain notes all read it. Add a field = one entry here + one column. It is a fixed schema, not a user field builder.
- `branding.ts`: `resolveBranding(publication, brandDefaults, brandName)`: own value → brand default → platform default, with the source of each value. Logos follow the same rule (see Logos).
- `logos.ts`: logo slots, `logoFor()`, artwork tone.
- `groups.ts`: funnel order for publication lists, `groupByFunnel()`: Free newsletters, Text letters & alerts (type "Text letter (SMS)" or "Alert service"), Front-end, Mid-tier, Back-end, High-ticket, Lifetime / bundles, Bonus / complimentary, Other. Type "Free newsletter" or tier "Free" is free (the old name "Free / lead gen" is accepted on import and saved as "Free"). Within a group: sortOrder, then name. Used by the wiki list and home and the Publication Setup list.
- `brain.ts`: facts, Brain notes, `publicationPromptContext()` for AI prompts, `matchPublication()` (promo product → publication by code, slug or name).

## Brain

Every save (publication, branding, editor, editor link, archive/restore, brand defaults) runs after the response and:

1. stores a **facts** JSON on the row (`calendar_publications.facts`, `pubsetup_editors.facts`);
2. calls `teachBrain()` for the brand's mini-brain: one note per publication (`sourceRef` `pub:<id>`, folder `Publications`) and per editor (`editor:<id>`, folder `Editors`). Re-saving updates the same note.

### Facts shape (v1)

```json
{
  "version": 1,
  "kind": "publication",
  "ref": "pub:<uuid>",
  "brand": "Brand name",
  "updatedAt": "2026-11-17T12:00:00.000Z",
  "fields": {
    "name": "The Daily Edge",
    "code": "TDE",
    "status": "active",
    "launchDate": "2024-05-01",
    "deliverables": ["Daily issue", "Model portfolio"],
    "retailPrice": "$7,500/yr",
    "offers": ["Annual · $49 · per year"],
    "editors": ["Ada Lee (Lead editor)"],
    "archived": "yes"
  }
}
```

- `fields` keys are the `fields.ts` keys (`PUBLICATION_FIELDS` / `EDITOR_FIELDS`), plus `editors` (publication), `publications` (editor) and `archived`. (Facts before 2026-11-17 also carried `senderName`/`senderEmail`; they are no longer written.)
- Pricing (`retailPrice`, `lifetimePrice`, `salePrice`, `pricingNotes`) is plain text exactly as typed, e.g. "$7,500/yr". Nothing computes or parses it.
- Values are a string or a list of strings. Only non-empty fields appear; layout-only fields (`sortOrder`) never do. An editor's `email` is never included.
- Pair fields are flattened: offers `"label · price · term"`, sample issues `"title url"`, social links `"label: url"`.
- A conflict checker compares `fields[key]` with what the Brain believes about `ref` and treats Publication Setup as the source of truth.

## Read API (`apps/web/src/features/pubsetup/read.ts`)

```ts
getPublications(orgId, brandId, { includeArchived?, activeOnly? }): Promise<Publication[]>
getPublication(orgId, brandId, idOrSlugOrCode): Promise<Publication | null>
getEditors(orgId, brandId, { includeArchived?, activeOnly? }): Promise<Editor[]>
getEditor(orgId, brandId, idOrSlug): Promise<Editor | null>
getBranding(orgId, publicationId): Promise<Branding | null>   // resolved, with sources
getBrandBranding(orgId, brandId): Promise<Branding>
getImage(orgId, kind, id, brandId?): Promise<{ data, mime, filename } | null>
findPublicationForProduct(orgId, brandId, product): Promise<Publication | null>
publicationPromptBlock(orgId, brandId, product): Promise<string>   // "" when none
getPickerOptions(orgId, brandId): Promise<{ publications: { code, name }[]; editors: string[] }>
```

Used today by Promo Analyzer (publisher/product/guru pickers) and Packager (publication block in prompts). `Editor.email` is internal: never show it on public or wiki pages.

## Import (`/settings/publication-setup/import`)

Admins can bring publications, editors and images in from a JSON file. The rules live
in `import.ts` (pure, tested in `import.test.ts`):

```json
{
  "format": "pubcommand.publication-setup/v1",
  "brand": { "logo": "data:image/png;base64,…", "logoDark": "data:image/svg+xml;base64,…" },
  "publications": [
    { "code": "WAR", "name": "…", "slug": "…", "tagline": "…", "deliverables": ["…"],
      "retailPrice": "$7,500/yr", "lifetimePrice": "…", "salePrice": "…", "pricingNotes": "…",
      "offers": [{ "label": "…", "price": "…", "term": "…" }], "logo": "data:image/png;base64,…",
      "logoLight": "data:image/png;base64,…", "logoDark": "data:image/png;base64,…",
      "editors": [{ "editor": "Editor Name", "role": "lead" }] }
  ],
  "editors": [{ "name": "…", "title": "…", "shortBio": "…", "longBio": "…", "specialties": ["…"], "photo": "data:image/jpeg;base64,…" }]
}
```

- Field keys are the ones in `fields.ts`, and each record is validated exactly like the form.
  Bad records are skipped with a warning; the rest still import.
- Publications match on code, editors on URL name or name. A match only gets the fields it
  has left blank (and a logo/photo if it has none). Nothing typed in the app is overwritten,
  so re-running a file is a no-op.
- `logoLight` (for light backgrounds) and `logoDark` (for dark backgrounds) go straight to that slot; `logo` is sorted by its artwork into a slot the record did not name (`placeLogos`). Only empty slots are filled.
- The dry run changes nothing. Each saved publication and editor teaches the Brain, as a form save does.
- A file may list `"replace": ["offers", …]` (publication fields only, never name/code/status/color/slug).
  Those fields take the file's value on existing publications, including being cleared, and the dry run
  says "replaces …". Use it to correct something an earlier import got wrong.
