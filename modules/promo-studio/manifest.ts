import { defineModule } from "@pubcommand/core";

export const manifest = defineModule({
  id: "promo-studio",
  slug: "promo-studio",
  name: "Promo Analyzer",
  description: "Upload promos, get a full copy analysis, and teach the brand Brain.",
  nav: [{ label: "Promo Analyzer", href: "/promo-studio", permission: "promo.read" }],
  routes: [
    { path: "/promo-studio", title: "Promo Analyzer" },
    { path: "/promo-studio/performance", title: "Promo performance" },
    { path: "/promo-studio/lessons", title: "Lessons learned" },
    { path: "/promo-studio/directory", title: "Promo directory" },
    { path: "/promo-studio/bulk", title: "Bulk re-analyze" },
    { path: "/promo-studio/training", title: "Packager training library" },
  ],
  permissions: [
    { key: "promo.read", description: "Read promotions" },
    { key: "promo.write", description: "Edit promotions" },
    { key: "promo.approve", description: "Approve promotions" },
  ],
  events: [{ name: "promo.approved", description: "A promotion was approved" }],
  jobs: [
    { name: "promo.publish", description: "Publish an approved promotion" },
    { name: "promo-studio.bulk-reanalyze", description: "Run queued promo re-analyses, two at a time" },
    { name: "promo-studio.sheets-sync", description: "Sync promo performance from Google Sheets" },
  ],
  settingsSchema: {
    type: "object",
    additionalProperties: false,
    properties: { requireApproval: { type: "boolean" } },
  },
  planEntitlement: "promo-studio",
});
