# Promo Studio

Route: `/promo-studio`. Permissions: `promo.read`, `promo.write`, `promo.approve`. Plan entitlement: `promo-studio`.

This slice shows an example catalog for one organization. It is not saved, and it does not call an analyzer.

## Catalog

`exampleCatalog(organizationId)` returns three example promos and one package, the Q2 acquisition bundle, that groups them. Every id is prefixed with the organization id. Looking up another organization's promo returns nothing, and a package drops members that belong somewhere else.

Each promo has a name, a status (`draft`, `in_review`, `approved`, or `archived`), and a score from 0 to 100.

## Stub scorer

`scorePromo` adds points you can read:

- a specific name (four or more words), a shorter name, or a missing name
- a number, dollar sign, or percent in the name
- a season or quarter (`spring`, `q4`, and the same kind of token)
- whether the status is approved, in review, draft, or archived

The points are added and then capped at 100. The spring rate-lock example sums past 100 so the cap is visible.

TODO: replace `scorePromo` with the real analyzer models.

## Packages

A package is a name plus promo ids. The page lists the promos in the bundle.

TODO: assemble the copy, art, and export files for a package. `promo.publish` is still only a declared job.

## UI

`PromoStudioView` renders that catalog. `apps/web/src/app/sites/org/[slug]/promo-studio/page.tsx` serves `/promo-studio`, so the Phase 1 placeholder does not. The page checks the plan and a promo permission first. Writing and approving are declared permissions. This slice does not edit records.

## The Packager (copy package)

`packager.ts` is the next stage of a promo: the component list (`PACKAGE_COMPONENTS`, with a live-event add-on), the niche-aware system prompt and per-component user prompt, the JSON answer shape, Markdown rendering, the claims post-check (`checkClaims`: base rules, the brand's niche rules, phrases quoted in the brand's compliance notes, and figures not found in the promo or offer details) and the Brain note for an approved package. Server code is in `apps/web/src/features/packager/`, pages under `promo-studio/[promoId]/package/`, tables in `packager.prisma`.
