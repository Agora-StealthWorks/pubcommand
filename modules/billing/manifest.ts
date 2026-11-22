import { defineModule } from "@pubcommand/core";

// Plan, seats, and add-ons: ./models, ./assignment, ./screen.
// Checkout charges and invoices are not collected in this slice.
// TODO: metering — seat totals are assigned counts, not usage records.
// TODO: SSO — not a billing provider. Auth owns SsoHooks.
// TODO: per-organization custom domains — this module does not call the Railway API.
export const manifest = defineModule({
  id: "billing",
  slug: "billing",
  name: "Billing",
  description: "Organization plan, seats, and module add-ons.",
  nav: [{ label: "Billing", href: "/billing", permission: "billing.read" }],
  routes: [{ path: "/billing", title: "Billing" }],
  permissions: [
    { key: "billing.read", description: "See the plan and seats" },
    { key: "billing.manage", description: "Change the plan" },
  ],
  events: [{ name: "billing.plan.changed", description: "Payload from assignOrgPlan. Nothing publishes it yet." }],
  jobs: [{ name: "billing.invoice", description: "TODO: not scheduled in this phase" }],
  settingsSchema: {
    type: "object",
    additionalProperties: false,
    properties: { invoiceEmail: { type: "string" } },
  },
  planEntitlement: "billing",
});
