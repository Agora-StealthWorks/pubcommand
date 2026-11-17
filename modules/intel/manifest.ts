import { defineModule } from "@pubcommand/core";

export const manifest = defineModule({
  id: "intel",
  slug: "intel",
  name: "Intel",
  description: "Competitor intelligence: competitors, their emails (upload, paste or Gmail), AI extraction and the weekly Promo Radar.",
  nav: [{ label: "Intel", href: "/intel", permission: "intel.read" }],
  routes: [{ path: "/intel", title: "Intel" }],
  permissions: [
    { key: "intel.read", description: "Read competitors, competitor emails and the Promo Radar" },
    { key: "intel.write", description: "Add competitors and emails, connect Gmail, run extraction and the radar" },
  ],
  events: [{ name: "intel.radar.ready", description: "A weekly Promo Radar was built" }],
  jobs: [
    { name: "intel.gmail.sync", description: "Pull new competitor email from connected Gmail inboxes" },
    { name: "intel.radar.build", description: "Build the weekly Promo Radar for each brand" },
  ],
  settingsSchema: {
    type: "object",
    additionalProperties: false,
    properties: { autoExtract: { type: "boolean" } },
  },
  planEntitlement: "intel",
});
