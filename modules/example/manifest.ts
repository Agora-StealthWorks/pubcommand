import { defineModule } from "@pubcommand/core";

export const manifest = defineModule({
  id: "example",
  slug: "example",
  name: "Example",
  description: "Reference module the registry loads. It has no product behavior.",
  nav: [{ label: "Example", href: "/example", permission: "example.view" }],
  routes: [{ path: "/example", title: "Example" }],
  permissions: [{ key: "example.view", description: "Open the example module stub" }],
  events: [{ name: "example.ping", description: "Placeholder event emitted by a future example job" }],
  jobs: [{ name: "example.ping", description: "Placeholder job. The worker lists it and does not run it." }],
  settingsSchema: {
    type: "object",
    additionalProperties: false,
    properties: { note: { type: "string" } },
  },
  planEntitlement: "example",
});
