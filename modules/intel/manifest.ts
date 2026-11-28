import { defineModule } from "@pubcommand/core";

export const manifest = defineModule({
  id: "intel",
  slug: "intel",
  name: "ISpy",
  description: "ISpy: one shared feed of what every publisher mails (FinPub and Health), split into Internal, External and Affiliate Lists, with copy-reuse tracking, new-promo detection by landing page, niche-wide trends and Send to Promo Analyzer. My captures keeps an org's own private uploads, Gmail and videos.",
  nav: [{ label: "ISpy", href: "/intel", permission: "intel.read" }],
  routes: [{ path: "/intel", title: "ISpy" }],
  permissions: [
    { key: "intel.read", description: "Read the ISpy feed, copies, promos, trends and My captures" },
    { key: "intel.write", description: "Send ISpy items to Promo Analyzer, report not-a-promo or duplicates, and manage My captures (uploads, Gmail, videos, settings)" },
  ],
  events: [{ name: "intel.radar.ready", description: "A weekly Promo Radar was built" }],
  jobs: [
    { name: "intel.gmail-sync", description: "Pull new competitor email from connected Gmail inboxes, then extract it" },
    { name: "intel.radar", description: "Build the weekly Promo Radar for each brand" },
    { name: "intel.digest", description: "Send the weekly Promo Radar digest to Slack and/or email" },
    { name: "intel.video-capture", description: "Capture queued competitor videos, one at a time" },
    { name: "ispy.inbox-poll", description: "Pull ISpy's MachineMail inboxes and refresh copy notes" },
    { name: "ispy.gmail-sync", description: "Pull ISpy's legacy Gmail inboxes and affiliate seeds" },
    { name: "ispy.promo-scan", description: "Resolve landing pages and match promos" },
    { name: "ispy.trends", description: "Build weekly niche-wide trends" },
    { name: "ispy.digest", description: "Send the daily ISpy digest" },
    { name: "ispy.import-legacy", description: "Import the old iSpy database on request" },
  ],
  settingsSchema: {
    type: "object",
    additionalProperties: false,
    properties: { autoExtract: { type: "boolean" } },
  },
  planEntitlement: "intel",
});
