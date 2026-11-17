import { defineModule } from "@pubcommand/core";

export const manifest = defineModule({
  id: "performance",
  slug: "performance",
  name: "Track Record",
  description: "Portfolios, recommendations and a call archive, with gains recalculated from real prices.",
  nav: [{ label: "Track Record", href: "/performance", permission: "performance.read" }],
  routes: [
    { path: "/performance", title: "Track Record" },
    { path: "/performance/archive", title: "Call archive" },
    { path: "/performance/import", title: "Import recommendations" },
    { path: "/performance/reports", title: "Weekly report" },
  ],
  permissions: [
    { key: "performance.read", description: "See portfolios, positions, stats and the call archive" },
    { key: "performance.write", description: "Add, edit, close and import recommendations; manage the call archive and public links" },
  ],
  events: [{ name: "performance.position.closed", description: "A recommendation was closed" }],
  jobs: [
    { name: "performance.import-sync", description: "Re-sync recommendations from connected Google Sheets and Airtable tables" },
    { name: "performance.price-refresh", description: "Refresh quotes and recompute peaks and splits" },
    { name: "performance.weekly-report", description: "Email the Friday weekly performance report to the chosen team members" },
    { name: "performance.weekly-summary", description: "Teach the brand Brain a weekly aggregate summary per portfolio" },
  ],
  settingsSchema: {
    type: "object",
    additionalProperties: false,
    properties: { timezone: { type: "string" } },
  },
  planEntitlement: "performance",
});
