import { defineModule } from "@pubcommand/core";

export const manifest = defineModule({
  id: "intel",
  slug: "intel",
  name: "Intel",
  description: "Competitor intelligence: competitors, their emails (upload, paste or Gmail) and videos, landing pages, AI extraction, expert/list/topic registries, CSV exports and the weekly Promo Radar with a Slack/email digest.",
  nav: [{ label: "Intel", href: "/intel", permission: "intel.read" }],
  routes: [{ path: "/intel", title: "Intel" }],
  permissions: [
    { key: "intel.read", description: "Read competitors, competitor emails and the Promo Radar" },
    { key: "intel.write", description: "Add competitors, emails and videos, connect Gmail, edit registries and settings, run extraction and the radar" },
  ],
  events: [{ name: "intel.radar.ready", description: "A weekly Promo Radar was built" }],
  jobs: [
    { name: "intel.gmail-sync", description: "Pull new competitor email from connected Gmail inboxes, then extract it" },
    { name: "intel.radar", description: "Build the weekly Promo Radar for each brand" },
    { name: "intel.digest", description: "Send the weekly Promo Radar digest to Slack and/or email" },
    { name: "intel.video-capture", description: "Capture queued competitor videos, one at a time" },
  ],
  settingsSchema: {
    type: "object",
    additionalProperties: false,
    properties: { autoExtract: { type: "boolean" } },
  },
  planEntitlement: "intel",
});
