import { defineModule } from "@pubcommand/core";

export const manifest = defineModule({
  id: "editorial",
  slug: "editorial",
  name: "Marketing Calendar",
  description: "Live events, editorial issues and send stats for every publication, on one calendar.",
  nav: [{ label: "Marketing Calendar", href: "/editorial", permission: "editorial.read" }],
  routes: [
    { path: "/editorial", title: "Running list" },
    { path: "/editorial/calendar", title: "Calendar" },
    { path: "/editorial/timeline", title: "Timeline" },
    { path: "/editorial/events/:id", title: "Event" },
    { path: "/editorial/issues/:id", title: "Issue" },
    { path: "/editorial/stats", title: "Send stats" },
    { path: "/editorial/analytics", title: "Editorial analytics" },
    { path: "/editorial/whats-working", title: "What's Working" },
    { path: "/editorial/cub", title: "CUB Collector" },
    { path: "/editorial/setup", title: "Publications and channels" },
  ],
  permissions: [
    { key: "editorial.read", description: "See the marketing calendar, issues, events and send stats" },
    { key: "editorial.write", description: "Add and edit events, issues, publications, stats and CUB rounds" },
    { key: "editorial.publish", description: "Publish editorial items" },
  ],
  events: [{ name: "editorial.item.published", description: "An editorial item was published" }],
  jobs: [{ name: "editorial.whats-working", description: "Summarize the top-performing issues of the last 30 days" }],
  settingsSchema: {
    type: "object",
    additionalProperties: false,
    properties: { defaultSection: { type: "string" } },
  },
  planEntitlement: "editorial",
});
