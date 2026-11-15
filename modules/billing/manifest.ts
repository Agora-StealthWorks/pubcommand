import { defineModule } from "@pubcommand/core";

// TODO: billing checkout, invoices, and seat changes are not implemented.
export const manifest = defineModule({
  id: "billing",
  slug: "billing",
  name: "Billing",
  description: "Plan, seats, and invoices. Manifest only.",
  nav: [{ label: "Billing", href: "/billing", permission: "billing.read" }],
  routes: [{ path: "/billing", title: "Billing" }],
  permissions: [
    { key: "billing.read", description: "Read the organization plan and seats" },
    { key: "billing.manage", description: "Change the organization plan" },
  ],
  events: [{ name: "billing.plan.changed", description: "TODO: emitted when a plan change is real" }],
  jobs: [{ name: "billing.invoice", description: "TODO: not scheduled in this phase" }],
  settingsSchema: {
    type: "object",
    additionalProperties: false,
    properties: { invoiceEmail: { type: "string" } },
  },
  planEntitlement: "billing",
});
