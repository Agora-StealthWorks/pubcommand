# App cards and the dashboard

An organization's dashboard (the home page of `{slug}.pubcommand.com`) shows one card per app: the card artwork (2:1) with the app's name under it. Clicking a card opens the app.

## Who sees which card

A card appears only when all of these hold:

1. Staff left the card **on the dashboard** (Admin → App cards).
2. The organization **has the app**: its plan includes it and the organization has not switched it off in Settings → Apps.
3. The person may open the app (their role's permissions), and the app fits the brand's niche (ChartBuilder and Track Record are finance only).

Cards are in the order staff set. Turning a card off removes it from dashboards only; the app stays in the sidebar and keeps working.

## Admin → App cards

The platform console has an **App cards** page (`admin.pubcommand.com/app-cards`) for staff who manage apps (permission `platform.modules.manage`: super admins and Ops). It lists every app in dashboard order. For each one staff can:

- **Rename the card.** The name also shows in the sidebar. Leaving it as the built-in name keeps the default.
- **Turn it on or off the dashboard.**
- **Upload card artwork**: PNG, JPEG or WebP, up to 2 MB, 2:1 (1200 × 600, or 2400 × 1200 for sharp screens). Other shapes are cropped to fit. **Remove upload** goes back to the default.
- **Move it up or down** to set the dashboard order.

**New apps.** Any app module with pages but no built-in card (today: Billing) is listed with a "New app" badge and starts off the dashboards. Turning it on adds its card to dashboards and the app to the sidebar under **More apps**, for organizations that have it. This is how a newly built app gets a card without a code change.

Defaults: the built-in apps are on, in the built-in order. Calendar, Brain, Wiki, Funnels, Mini-Blog, Forms, iSpy (the Intel app), Websites, Testimonials and Support Knowledge ship with artwork (`apps/web/public/brand/app-cards/`). Apps with neither an upload nor bundled artwork show a simple drawing.

## Where it lives

- Settings: the `app_cards` table (one row per app that staff changed; a platform table with no organization). Uploaded images are stored in the row and served from `/api/app-cards/{moduleId}?v=…` on every host.
- Logic: `apps/web/src/lib/apps.ts` (`visibleApps`, `dashboardCards`, `cardableApps`, `appCardImage`).
- Every save, upload, removal and move writes a platform audit row (`app_card.updated`, `app_card.image_uploaded`, `app_card.image_removed`, `app_card.moved`, target `app_card` / the module id).
