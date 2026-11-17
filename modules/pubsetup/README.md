# Publication Setup

Route `/publication-setup` (module id and slug `pubsetup`; `/pubsetup` redirects). **Admins only.**

The one place a publisher records each publication, its editors and its branding. Every other app reads it; the Brain learns from it; the wiki only displays it.

## Access

- One permission, `pubsetup.manage`, given to the `owner` and `admin` roles (migration `20261117070000_pubsetup_publications_editors`, and new orgs through the registry). There is deliberately no read tier.
- `canManagePublications()` (`access.ts`) = plan entitles `pubsetup` **and** `can(…, "pubsetup.manage")`. Every page, action and route calls it (`features/pubsetup/guard.ts`).
- Other apps read publications through `apps/web/src/features/pubsetup/read.ts` under **their own** permission checks.

## Data (models in `packages/db/prisma/schema/pubsetup.prisma`)

| Table | What |
| --- | --- |
| `calendar_publications` (model `CalendarPublication`) | Publications. The Marketing Calendar's table, moved here unchanged and extended with Publication Setup columns. |
| `pubsetup_editors` (`PubEditor`) | Editors / experts, photo as bytes. |
| `pubsetup_publication_editors` (`PubPublicationEditor`) | Who writes which publication, with a role (`lead`, `co-editor`, `contributor`, `analyst`, `guest`). Cascades with either side. |
| `pubsetup_brand_branding` (`PubBrandBranding`) | One row per brand: branding defaults publications inherit. |

Why the calendar table: issues, send stats, Mini-Blog and the CUB/What's Working code all key on `calendar_publications` (by `brand_id` + `code`). Keeping the table, model name and every column means none of them change and no data moves; Publication Setup adds nullable or defaulted columns only. `slug` was backfilled from `code` (unique per brand, `-2` on a clash), `status` from `active`.

Rules:

- `active` stays the calendar's "show in pickers" flag: it is `false` for `status = retired` and for archived rows.
- Archive = `deleted_at` (soft delete). Archived publications drop out of pickers but old issues and stats keep them; restore puts them back. Nothing is hard-deleted.
- Changing a code updates `calendar_issues.publication_code` so issues stay attached (as the calendar did).
- Images (logo, cover, email header, editor photo, brand logo/header) are `Bytes` columns. `/publication-setup/image/<kind>/<id>` serves them to admins; other apps call `getImage()` and serve from their own route.

## Pure code (this folder, tested in `pubsetup.test.ts`)

- `fields.ts`: **the field list** for publications, editors and branding (key, label, kind, group, limits, options). Forms, validation (`parseFields`), facts and Brain notes all read it. Add a field = one entry here + one column. It is a fixed schema, not a user field builder.
- `branding.ts`: `resolveBranding(publication, brandDefaults, brandName)`: own value → brand default → platform default, with the source of each value. Logos and email headers follow the same rule.
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
    "offers": ["Annual · $49 · per year"],
    "editors": ["Ada Lee (Lead editor)"],
    "senderName": "The Daily Edge Desk",
    "archived": "yes"
  }
}
```

- `fields` keys are the `fields.ts` keys (`PUBLICATION_FIELDS` / `EDITOR_FIELDS`), plus `editors` (publication), `publications` (editor), `senderName`/`senderEmail` (resolved branding) and `archived`.
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

## Import (`/publication-setup/import`)

Admins can bring publications, editors and images in from a JSON file. The rules live
in `import.ts` (pure, tested in `import.test.ts`):

```json
{
  "format": "pubcommand.publication-setup/v1",
  "brand": { "logo": "data:image/png;base64,…" },
  "publications": [
    { "code": "WAR", "name": "…", "slug": "…", "tagline": "…", "deliverables": ["…"],
      "offers": [{ "label": "…", "price": "…", "term": "…" }], "logo": "data:image/png;base64,…",
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
- The dry run changes nothing. Each saved publication and editor teaches the Brain, as a form save does.
