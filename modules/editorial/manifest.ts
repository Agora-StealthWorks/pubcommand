import { defineModule } from "@pubcommand/core";

export const manifest = defineModule({
  id: "editorial",
  slug: "editorial",
  name: "Calendar",
  description: "Live events, editorial issues and send stats for every publication, on one calendar.",
  nav: [{ label: "Calendar", href: "/editorial", permission: "editorial.read" }],
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
    { path: "/editorial/promos", title: "Promo pipeline" },
    { path: "/editorial/tickers", title: "Tickers (finance brands)" },
    { path: "/editorial/setup", title: "Setup: channels, field options, emails, trash, Airtable" },
  ],
  permissions: [
    { key: "editorial.read", description: "See the calendar, issues, events and send stats" },
    { key: "editorial.write", description: "Add and edit events, issues, publications, stats and CUB rounds" },
    { key: "editorial.publish", description: "Publish editorial items" },
  ],
  events: [{ name: "editorial.item.published", description: "An editorial item was published" }],
  jobs: [
    { name: "editorial.whats-working", description: "Summarize the top-performing issues of the last 30 days" },
    { name: "editorial.cub-emails", description: "CUB reminders (9:05 am ET, business day before) and post-deadline emails" },
    { name: "editorial.series-extend", description: "Keep open-ended recurring series planned six months ahead" },
    { name: "editorial.airtable-sync", description: "Optional two-way Airtable sync" },
    { name: "editorial.brain-catchup", description: "Teach the brand Brain about issues and events saved elsewhere" },
    { name: "editorial.ticker-prices", description: "Prices for tickers mentioned in editorial (finance brands)" },
  ],
  settingsSchema: {
    type: "object",
    additionalProperties: false,
    properties: { defaultSection: { type: "string" } },
  },
  planEntitlement: "editorial",
});
