import { defineModule } from "@pubcommand/core";

export const manifest = defineModule({
  id: "performance",
  slug: "performance",
  name: "Performance",
  description: "Recommendation results and launch-funnel placeholders for this organization.",
  nav: [{ label: "Performance", href: "/performance", permission: "performance.read" }],
  routes: [{ path: "/performance", title: "Performance" }],
  permissions: [
    { key: "performance.read", description: "Read performance reports" },
    { key: "performance.write", description: "Record performance entries and broker imports" },
  ],
  events: [{ name: "performance.snapshot.ready", description: "A performance snapshot was stored" }],
  jobs: [
    {
      name: "performance.snapshot",
      description: "Collect a performance snapshot. TODO: broker imports are not connected.",
    },
  ],
  settingsSchema: {
    type: "object",
    additionalProperties: false,
    properties: { timezone: { type: "string" } },
  },
  planEntitlement: "performance",
});
