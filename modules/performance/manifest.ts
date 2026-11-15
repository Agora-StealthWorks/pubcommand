import { defineModule } from "@pubcommand/core";

export const manifest = defineModule({
  id: "performance",
  slug: "performance",
  name: "Performance",
  description: "Performance reporting. Not implemented in Phase 1.",
  nav: [{ label: "Performance", href: "/performance", permission: "performance.read" }],
  routes: [{ path: "/performance", title: "Performance" }],
  permissions: [{ key: "performance.read", description: "Read performance reports" }],
  events: [{ name: "performance.snapshot.ready", description: "A performance snapshot was stored" }],
  jobs: [{ name: "performance.snapshot", description: "Collect a performance snapshot" }],
  settingsSchema: {
    type: "object",
    additionalProperties: false,
    properties: { timezone: { type: "string" } },
  },
  planEntitlement: "performance",
});
