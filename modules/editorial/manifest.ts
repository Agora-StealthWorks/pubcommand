import { defineModule } from "@pubcommand/core";

export const manifest = defineModule({
  id: "editorial",
  slug: "editorial",
  name: "Editorial",
  description: "Editorial planning. Not implemented in Phase 1.",
  nav: [{ label: "Editorial", href: "/editorial", permission: "editorial.read" }],
  routes: [{ path: "/editorial", title: "Editorial" }],
  permissions: [
    { key: "editorial.read", description: "Read the editorial calendar" },
    { key: "editorial.write", description: "Edit editorial items" },
    { key: "editorial.publish", description: "Publish editorial items" },
  ],
  events: [{ name: "editorial.item.published", description: "An editorial item was published" }],
  jobs: [{ name: "editorial.schedule.tick", description: "Advance scheduled editorial items" }],
  settingsSchema: {
    type: "object",
    additionalProperties: false,
    properties: { defaultSection: { type: "string" } },
  },
  planEntitlement: "editorial",
});
