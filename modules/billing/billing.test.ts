import { describe, expect, it } from "vitest";
import { assignOrgPlan, occupiedSeatCount } from "./assignment";
import { manifest } from "./manifest";
import { BillingModelError, createModuleAddOn, createPlan, createSeat } from "./models";
import { buildPlansSettingsScreen, staffPlanManagementVisible } from "./screen";
import { createStripeClient, stripeEnvStatus } from "./stripe";
import type { StripeFetch } from "./stripe";
import { BILLING_TODOS } from "./todos";

const starter = createPlan({
  id: "plan_starter",
  key: "starter",
  name: "Starter",
  seatLimit: 2,
  monthlyPriceCents: 0,
  moduleIds: ["knowledge", "settings"],
});

const team = createPlan({
  id: "plan_team",
  key: "team",
  name: "Team",
  seatLimit: 5,
  monthlyPriceCents: 4900,
  moduleIds: ["knowledge", "billing", "settings"],
});

const catalog = [starter, team];

function seat(id: string, status: "assigned" | "invited" | "released", userId: string | null = "user_1") {
  return createSeat({ id, organizationId: "org_1", userId, status });
}

describe("billing manifest", () => {
  it("keeps the module contract", () => {
    expect(manifest.id).toBe("billing");
    expect(manifest.slug).toBe("billing");
    expect(manifest.planEntitlement).toBe("billing");
    expect(manifest.nav[0]).toMatchObject({ href: "/billing", permission: "billing.read" });
    expect(manifest.permissions.map((permission) => permission.key)).toEqual(["billing.read", "billing.manage"]);
  });
});

describe("billing models", () => {
  it("builds a plan, a seat, and a module add-on", () => {
    expect(starter.moduleIds).toEqual(["knowledge", "settings"]);
    expect(seat("seat_1", "assigned").status).toBe("assigned");
    expect(
      createModuleAddOn({
        id: "addon_1",
        organizationId: "org_1",
        moduleId: "charts",
        monthlyPriceCents: 900,
        active: true,
      }).moduleId,
    ).toBe("charts");
  });

  it("rejects an assigned seat with no user", () => {
    expect(() => seat("seat_1", "assigned", null)).toThrow(BillingModelError);
  });
});

describe("assignOrgPlan", () => {
  it("assigns the catalog plan and returns the plan-changed event", () => {
    const result = assignOrgPlan({
      organizationId: "org_1",
      planId: team.id,
      catalog,
      seats: [seat("seat_1", "assigned", "user_1"), seat("seat_2", "released", "user_2")],
      addOns: [
        createModuleAddOn({
          id: "addon_1",
          organizationId: "org_1",
          moduleId: "charts",
          monthlyPriceCents: 900,
          active: true,
        }),
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assignment.planId).toBe(team.id);
    expect(result.assignment.seatLimit).toBe(5);
    expect(result.event).toEqual({
      name: "billing.plan.changed",
      organizationId: "org_1",
      planId: team.id,
      seatLimit: 5,
    });
    expect(occupiedSeatCount(result.assignment.seats)).toBe(1);
  });

  it("refuses a plan that would drop occupied seats", () => {
    const result = assignOrgPlan({
      organizationId: "org_1",
      planId: starter.id,
      catalog,
      seats: [
        seat("seat_1", "assigned"),
        seat("seat_2", "invited", "user_2"),
        seat("seat_3", "assigned", "user_3"),
      ],
      addOns: [],
    });
    expect(result).toMatchObject({
      ok: false,
      code: "seat_limit",
      message: "This plan includes 2 seats and the organization is using 3.",
    });
  });

  it("refuses an unknown plan and a seat from another organization", () => {
    expect(
      assignOrgPlan({
        organizationId: "org_1",
        planId: "missing",
        catalog,
        seats: [],
        addOns: [],
      }),
    ).toMatchObject({ ok: false, code: "unknown_plan" });

    expect(
      assignOrgPlan({
        organizationId: "org_1",
        planId: team.id,
        catalog,
        seats: [createSeat({ id: "seat_other", organizationId: "org_2", userId: "user_9", status: "assigned" })],
        addOns: [],
      }),
    ).toMatchObject({ ok: false, code: "foreign_seat" });

    expect(
      assignOrgPlan({
        organizationId: "org_1",
        planId: team.id,
        catalog,
        seats: [],
        addOns: [
          createModuleAddOn({
            id: "addon_other",
            organizationId: "org_2",
            moduleId: "charts",
            monthlyPriceCents: 100,
            active: true,
          }),
        ],
      }),
    ).toMatchObject({ ok: false, code: "foreign_add_on" });
  });
});

describe("plans settings screen", () => {
  it("hides the organization plan when the member cannot read billing", () => {
    const screen = buildPlansSettingsScreen({
      canRead: false,
      canManage: true,
      catalog,
      assignment: null,
      stripe: { secretKey: true, webhookSecret: true, publishableKey: true },
    });
    expect(screen.denied).toBe(true);
    expect(screen.current).toBeNull();
    expect(screen.choices).toEqual([]);
    expect(screen.stripe.enabled).toBe(false);
    expect(screen.upcoming).toEqual([]);
  });

  it("shows the plan, seats, and add-ons, and choices only for managers", () => {
    const assigned = assignOrgPlan({
      organizationId: "org_1",
      planId: team.id,
      catalog,
      seats: [seat("seat_1", "assigned", "user_1")],
      addOns: [
        createModuleAddOn({
          id: "addon_charts",
          organizationId: "org_1",
          moduleId: "charts",
          monthlyPriceCents: 900,
          active: true,
        }),
      ],
    });
    if (!assigned.ok) throw new Error(assigned.message);

    const reader = buildPlansSettingsScreen({
      canRead: true,
      canManage: false,
      catalog,
      assignment: assigned.assignment,
      stripe: stripeEnvStatus({}),
    });
    expect(reader.route).toBe("/billing");
    expect(reader.current).toMatchObject({ name: "Team", price: "$49.00 / month", seatsUsed: 1, seatLimit: 5 });
    expect(reader.seats).toEqual([{ id: "seat_1", holder: "user_1", status: "assigned" }]);
    expect(reader.addOns[0]).toMatchObject({ moduleId: "charts", includedInPlan: false, price: "$9.00 / month" });
    expect(reader.choices).toEqual([]);
    expect(reader.stripe.detail).toContain("STRIPE_SECRET_KEY");
    expect(reader.upcoming.map((todo) => todo.id)).toEqual(BILLING_TODOS.map((todo) => todo.id));

    const manager = buildPlansSettingsScreen({
      canRead: true,
      canManage: true,
      catalog,
      assignment: assigned.assignment,
      stripe: stripeEnvStatus({ STRIPE_SECRET_KEY: "sk_test_billing_slice" }),
    });
    expect(manager.choices.map((choice) => choice.planId)).toEqual(["plan_starter", "plan_team"]);
    expect(manager.choices[1]?.current).toBe(true);
    expect(manager.stripe.enabled).toBe(true);
  });
});

describe("staff plan management", () => {
  it("is visible to billing staff only when the admin console exists", () => {
    expect(staffPlanManagementVisible(true, "SUPER_ADMIN")).toBe(true);
    expect(staffPlanManagementVisible(true, "BILLING")).toBe(true);
    expect(staffPlanManagementVisible(true, "SUPPORT")).toBe(false);
    expect(staffPlanManagementVisible(true, "OPS")).toBe(false);
    expect(staffPlanManagementVisible(true, null)).toBe(false);
    expect(staffPlanManagementVisible(false, "SUPER_ADMIN")).toBe(false);
  });
});

describe("stripe client", () => {
  it("no-ops without STRIPE_SECRET_KEY and does not call fetch", async () => {
    const fetchImpl: StripeFetch = () => {
      throw new Error("fetch should not run");
    };
    for (const env of [{}, { STRIPE_SECRET_KEY: "  " }, { STRIPE_SECRET_KEY: undefined }]) {
      const client = createStripeClient(env, fetchImpl);
      expect(client.enabled).toBe(false);
      expect(await client.createCustomer({ organizationId: "org_1" })).toEqual({
        ok: false,
        skipped: true,
        reason: "missing_secret",
      });
      expect(await client.createCheckoutSession({
        organizationId: "org_1",
        planKey: "team",
        planName: "Team",
        monthlyPriceCents: 4900,
        successUrl: "https://example.test/ok",
        cancelUrl: "https://example.test/cancel",
      })).toEqual({ ok: false, skipped: true, reason: "missing_secret" });
    }
    expect(stripeEnvStatus({ STRIPE_WEBHOOK_SECRET: "whsec_test", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test" })).toEqual({
      secretKey: false,
      webhookSecret: true,
      publishableKey: true,
    });
  });

  it("posts to Stripe only when the secret is set, and keeps the secret out of the body", async () => {
    const secret = "sk_test_billing_slice_secret";
    const calls: { url: string; init: { headers: Record<string, string>; body: string; redirect: string } }[] = [];
    const fetchImpl: StripeFetch = (url, init) => {
      calls.push({ url, init });
      const id = url.endsWith("/customers") ? "cus_test" : "cs_test";
      return Promise.resolve(new Response(JSON.stringify({ id }), { status: 200 }));
    };
    const client = createStripeClient({ STRIPE_SECRET_KEY: secret }, fetchImpl);
    expect(client.enabled).toBe(true);
    expect(await client.createCustomer({ organizationId: "org_1", email: "desk@example.test" })).toEqual({
      ok: true,
      skipped: false,
      id: "cus_test",
    });
    expect(
      await client.createCheckoutSession({
        organizationId: "org_1",
        planKey: "team",
        planName: "Team",
        monthlyPriceCents: 4900,
        successUrl: "https://example.test/ok",
        cancelUrl: "https://example.test/cancel",
      }),
    ).toEqual({ ok: true, skipped: false, id: "cs_test" });

    expect(calls.map((call) => call.url)).toEqual([
      "https://api.stripe.com/v1/customers",
      "https://api.stripe.com/v1/checkout/sessions",
    ]);
    for (const call of calls) {
      expect(call.init.headers.Authorization).toBe(`Bearer ${secret}`);
      expect(call.init.redirect).toBe("manual");
      expect(call.init.body).not.toContain(secret);
      expect(call.url).not.toContain(secret);
    }
    expect(decodeURIComponent(calls[1]?.init.body ?? "")).toContain("unit_amount]=4900");
    expect("enabled" in client && !("secret" in client)).toBe(true);
  });

  it("returns a Stripe error without throwing", async () => {
    const fetchImpl: StripeFetch = () =>
      Promise.resolve(new Response(JSON.stringify({ error: { message: "No such customer" } }), { status: 400 }));
    const client = createStripeClient({ STRIPE_SECRET_KEY: "sk_test_billing_slice" }, fetchImpl);
    await expect(client.createCustomer({ organizationId: "org_1" })).resolves.toEqual({
      ok: false,
      skipped: false,
      status: 400,
      message: "No such customer",
    });
  });
});
