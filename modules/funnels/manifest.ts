import { defineModule } from "@pubcommand/core";

export const manifest = defineModule({
  id: "funnels",
  slug: "funnels",
  name: "Funnels",
  description: "Launch funnels: waitlist, day-by-day videos and a close page.",
  nav: [{ label: "Funnels", href: "/funnels", permission: "funnels.read" }],
  routes: [{ path: "/funnels", title: "Launch funnels" }],
  permissions: [
    { key: "funnels.read", description: "See funnels and their stats" },
    { key: "funnels.write", description: "Build and edit funnels" },
    { key: "funnels.publish", description: "Publish funnels and export opt-ins" },
  ],
  events: [
    { name: "funnels.published", description: "A launch funnel was published" },
  ],
  jobs: [],
  settingsSchema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  planEntitlement: "funnels",
});
