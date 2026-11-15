import { defineModule } from "@pubcommand/core";

export const manifest = defineModule({
  id: "promo-studio",
  slug: "promo-studio",
  name: "Promo Studio",
  description: "Promotion drafting and approval. Not implemented in Phase 1.",
  nav: [{ label: "Promo Studio", href: "/promo-studio", permission: "promo.read" }],
  routes: [{ path: "/promo-studio", title: "Promo Studio" }],
  permissions: [
    { key: "promo.read", description: "Read promotions" },
    { key: "promo.write", description: "Edit promotions" },
    { key: "promo.approve", description: "Approve promotions" },
  ],
  events: [{ name: "promo.approved", description: "A promotion was approved" }],
  jobs: [{ name: "promo.publish", description: "Publish an approved promotion" }],
  settingsSchema: {
    type: "object",
    additionalProperties: false,
    properties: { requireApproval: { type: "boolean" } },
  },
  planEntitlement: "promo-studio",
});
