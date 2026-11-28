# Module contract

Other PRs build against this file. The foundation loads manifests and renders nav. It does not implement product features.

A module is `modules/<id>/manifest.ts` plus `README.md`. `id`, `slug`, and `planEntitlement` are the same string. The organization host serves `https://{org}.{ROOT_DOMAIN}/{slug}`.

Register the manifest in `modules/src/index.ts`. The registry rejects duplicate ids, slugs, and permission keys. The sidebar links the first `nav` item; further items are the app's sub-menu, shown under it while it is open. The shell shows `nav` only when `can()` allows the item's permission and the plan entitles `planEntitlement`.

## Stable manifests

| id / slug | Nav href | Permissions | Plan entitlement |
| --- | --- | --- | --- |
| `knowledge` | `/knowledge` | `knowledge.read`, `knowledge.write` | `knowledge` |
| `editorial` | `/editorial` | `editorial.read`, `editorial.write`, `editorial.publish` | `editorial` |
| `performance` | `/performance` | `performance.read` | `performance` |
| `promo-studio` | `/promo-studio` | `promo.read`, `promo.write`, `promo.approve` | `promo-studio` |
| `intel` | `/ispy` (iSpy; `/intel` redirects) | `intel.read` | `intel` |
| `forms` | `/forms` | `forms.read`, `forms.write`, `forms.export` | `forms` |
| `charts` | `/charts` | `charts.read` | `charts` |
| `billing` | `/billing` | `billing.read`, `billing.manage` | `billing` |
| `websites` | `/websites` (+ sub-menu) | `websites.read`, `websites.write`, `websites.publish`, `websites.members` | `websites` |

Each manifest also declares `routes`, `events`, `jobs`, and `settingsSchema`. Those arrays are placeholders.

`settings` is the shell (`/settings`), not one of the modules above. `example` is the copy-me stub (`example.view`).

## TODO

Do not implement knowledge, editorial, performance, promo-studio, intel, forms, charts, or billing in the foundation. Later PRs own the pages, jobs, and events. Billing checkout and invoices are out of scope here.

## Entitlement, roles and app access

- **Which apps an org has** is decided in one place: `packages/db/src/entitlements.ts` (rules in `packages/core/src/entitlements.ts`). Allowed = staff override (`organization_app_access`, Admin → Organization → Apps) ?? plan. Entitled = allowed AND the org's own switch (Settings → Apps). `settings` is always on. Pages use `ctx.subject.entitledModuleIds`; public pages, APIs and jobs use `organizationHasModule()` / `organizationsWithModule()`. Never re-derive it from `plan.modules`.
- **Read vs write**: each manifest permission may set `access: "read" | "write" | "admin"`. Without it, `.read`/`.view` keys are read and everything else is write (`permissionAccess()` in `packages/core/src/member-access.ts`). Set it when a name would mislead.
- **Built-in roles**: User (all read permissions, the default for new members) and Editor (User + `websites.write`). Created create-only per organization (`ensure-roles` on boot).
- **Per-member app access** (Settings → Users → a member): Role default / No access / View / Edit, stored in `member_app_access` and turned into grants and exclusions in `loadAccessSubject`, so `can()` stays the only check.
- **Deleted organizations** (`deleted_at`) do not resolve, do not serve custom domains, and are skipped by jobs; `platform.org-purge` erases them 30 days later.
