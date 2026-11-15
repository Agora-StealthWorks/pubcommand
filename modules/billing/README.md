# Billing

Organization plan, seats, and module add-ons. Route: `/billing`. Permissions: `billing.read`, `billing.manage`. Plan entitlement: `billing`.

The foundation registry already loads `manifest.ts`. This folder is the working slice. It does not change auth, tenancy, or other modules.

## Models

`Plan`, `Seat`, and `ModuleAddOn` are built with `createPlan`, `createSeat`, and `createModuleAddOn`. A seat counts as occupied when it is assigned or invited. Released seats stay on the record and do not count.

## Plan assignment

`assignOrgPlan` copies the selected catalog plan onto an organization. The plan must be in the catalog. Occupied seats must fit the plan's seat limit. Seats and add-ons from another organization are refused. A successful assignment returns a `billing.plan.changed` payload. Nothing publishes that event yet.

`buildPlansSettingsScreen` is the plans settings screen for `/billing`. Members with `billing.read` see the current plan, seats, and add-ons. Members with `billing.manage` also see the catalog. Anyone else gets a denied screen with no billing data.

Platform staff see plan management when the admin console exists and `staffPlanManagementVisible` is true. That is the super admin and billing staff roles (`platform.plans.manage`). Support and ops do not. The console itself is the foundation `/plans` page.

## Stripe

`createStripeClient` reads `STRIPE_SECRET_KEY` at call time. When the value is missing or blank, `createCustomer` and `createCheckoutSession` return `{ skipped: true, reason: "missing_secret" }` and do not call the network. When it is set, those methods POST to the Stripe API. The secret stays in the client closure.

Set these in the host environment. Do not commit values. They are not in `.env.example` in this change.

| Name | Use |
| --- | --- |
| `STRIPE_SECRET_KEY` | Server secret. Blank means the client no-ops. |
| `STRIPE_WEBHOOK_SECRET` | Reserved for webhook signature checks. This slice only reports whether it is set. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Reserved for a browser checkout form. This slice only reports whether it is set. |

`stripeEnvStatus` reports those three as booleans. It does not return the secret or the webhook secret.

## TODO

- Metering. Seat totals are assigned counts, not usage records.
- SSO. Provider sign-in stays on the auth `SsoHooks` interface. Billing does not connect a provider.
- Per-organization custom domains. This module does not call the Railway API.

Checkout charges, invoices, and the `billing.invoice` job are not implemented. The settings screen lists the same three TODOs for members who can read billing.

## Tests

`billing.test.ts` covers the models, assignment, the settings screen, staff visibility, and the Stripe no-op. The modules package runner includes `src/**/*.test.ts` only, so this file is not part of `pnpm test` until that include is widened.
