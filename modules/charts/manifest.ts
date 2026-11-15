import { defineModule } from "@pubcommand/core";

export const manifest = defineModule({
  id: "charts",
  slug: "charts",
  name: "Charts",
  description: "Charts. Not implemented in Phase 1.",
  nav: [{ label: "Charts", href: "/charts", permission: "charts.read" }],
  routes: [{ path: "/charts", title: "Charts" }],
  permissions: [{ key: "charts.read", description: "Read charts" }],
  events: [{ name: "charts.snapshot.ready", description: "A chart snapshot was stored" }],
  jobs: [{ name: "charts.refresh", description: "Refresh chart snapshots" }],
  settingsSchema: {
    type: "object",
    additionalProperties: false,
    properties: { palette: { type: "string" } },
  },
  planEntitlement: "charts",
});
