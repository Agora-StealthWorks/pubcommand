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
  ],
  permissions: [
    { key: "performance.read", description: "See portfolios, positions, stats and the call archive" },
    { key: "performance.write", description: "Add, edit, close and import recommendations; manage the call archive and public links" },
  ],
  events: [{ name: "performance.position.closed", description: "A recommendation was closed" }],
  jobs: [{ name: "performance.weekly-summary", description: "Teach the brand Brain a weekly aggregate summary per portfolio" }],
  settingsSchema: {
    type: "object",
    additionalProperties: false,
    properties: { timezone: { type: "string" } },
  },
  planEntitlement: "performance",
});
