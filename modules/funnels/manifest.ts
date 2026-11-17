import { defineModule } from "@pubcommand/core";

export const manifest = defineModule({
  id: "funnels",
  slug: "funnels",
  name: "Funnels",
  description: "Launch funnels (waitlist, day-by-day videos, close page) and text-letter sites with SMS opt-ins.",
  nav: [{ label: "Funnels", href: "/funnels", permission: "funnels.read" }],
  routes: [
    { path: "/funnels", title: "Launch funnels" },
    { path: "/funnels/text", title: "Text-letter sites" },
  ],
  permissions: [
    { key: "funnels.read", description: "See funnels, text-letter sites and their stats" },
    { key: "funnels.write", description: "Build and edit funnels, sites and posts" },
    { key: "funnels.publish", description: "Publish funnels and sites, and export opt-ins" },
  ],
  events: [
    { name: "funnels.published", description: "A launch funnel was published" },
    { name: "funnels.post.published", description: "A text-letter post was published" },
  ],
  jobs: [],
  settingsSchema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  planEntitlement: "funnels",
});
