import { defineModule } from "@pubcommand/core";

export const manifest = defineModule({
  id: "intel",
  slug: "intel",
  name: "Intel",
  description: "Market and audience intel. Not implemented in Phase 1.",
  nav: [{ label: "Intel", href: "/intel", permission: "intel.read" }],
  routes: [{ path: "/intel", title: "Intel" }],
  permissions: [{ key: "intel.read", description: "Read intel briefs" }],
  events: [{ name: "intel.brief.ready", description: "An intel brief was stored" }],
  jobs: [{ name: "intel.collect", description: "Collect an intel brief" }],
  settingsSchema: {
    type: "object",
    additionalProperties: false,
    properties: { region: { type: "string" } },
  },
  planEntitlement: "intel",
});
