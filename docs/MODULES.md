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
| `intel` | `/intel` | `intel.read` | `intel` |
| `forms` | `/forms` | `forms.read`, `forms.write`, `forms.export` | `forms` |
| `charts` | `/charts` | `charts.read` | `charts` |
| `billing` | `/billing` | `billing.read`, `billing.manage` | `billing` |
| `websites` | `/websites` (+ sub-menu) | `websites.read`, `websites.write`, `websites.publish`, `websites.members` | `websites` |

Each manifest also declares `routes`, `events`, `jobs`, and `settingsSchema`. Those arrays are placeholders.

`settings` is the shell (`/settings`), not one of the modules above. `example` is the copy-me stub (`example.view`).

## TODO

Do not implement knowledge, editorial, performance, promo-studio, intel, forms, charts, or billing in the foundation. Later PRs own the pages, jobs, and events. Billing checkout and invoices are out of scope here.
