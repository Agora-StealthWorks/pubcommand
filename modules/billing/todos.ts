/** Work this slice does not do. */
export const BILLING_TODOS = [
  {
    id: "metering",
    summary: "Usage metering is not implemented. Seat totals are assigned counts, not usage records.",
  },
  {
    id: "sso",
    summary: "SSO is not billed or connected here. Provider sign-in stays on the auth SsoHooks interface.",
  },
  {
    id: "custom-domains",
    summary: "Per-organization custom domains are not implemented. This module does not call the Railway API.",
  },
] as const;

export type BillingTodoId = (typeof BILLING_TODOS)[number]["id"];
