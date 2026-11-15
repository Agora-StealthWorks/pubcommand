import { defineModule } from "@pubcommand/core";

export const manifest = defineModule({
  id: "intel",
  slug: "intel",
  name: "Intel",
  description: "Competitor lists, ingested email excerpts, and example historical calls.",
  nav: [{ label: "Intel", href: "/intel", permission: "intel.read" }],
  routes: [{ path: "/intel", title: "Intel" }],
  permissions: [{ key: "intel.read", description: "Read competitor intel, ingested email, and example calls" }],
  events: [{ name: "intel.brief.ready", description: "An intel brief was stored" }],
  jobs: [{ name: "intel.collect", description: "TODO: run extractors. Scrapers are not implemented and must not fetch." }],
  settingsSchema: {
    type: "object",
    additionalProperties: false,
    properties: { region: { type: "string" } },
  },
  planEntitlement: "intel",
});
