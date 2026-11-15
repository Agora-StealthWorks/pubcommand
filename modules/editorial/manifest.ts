import { defineModule } from "@pubcommand/core";

export const manifest = defineModule({
  id: "editorial",
  slug: "editorial",
  name: "Editorial",
  description: "Issues, send stats, and a stub writing assist for each organization.",
  nav: [{ label: "Editorial", href: "/editorial", permission: "editorial.read" }],
  routes: [
    { path: "/editorial", title: "Issues" },
    { path: "/editorial?issue=:id", title: "Issue" },
  ],
  permissions: [
    { key: "editorial.read", description: "Read the editorial calendar" },
    { key: "editorial.write", description: "Edit editorial items" },
    { key: "editorial.publish", description: "Publish editorial items" },
  ],
  events: [{ name: "editorial.item.published", description: "An editorial item was published" }],
  jobs: [
    { name: "editorial.schedule.tick", description: "Advance scheduled editorial items" },
    {
      name: "editorial.esp.sync",
      description: "TODO: Pull opens, clicks, and revenue from the ESP for each issue and organization. Not implemented.",
    },
  ],
  settingsSchema: {
    type: "object",
    additionalProperties: false,
    properties: { defaultSection: { type: "string" } },
  },
  planEntitlement: "editorial",
});
