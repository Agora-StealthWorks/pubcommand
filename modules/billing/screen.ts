import { PLATFORM_PERMISSIONS, platformCan } from "@pubcommand/core";
import type { PlatformRole } from "@pubcommand/core";
import { occupiedSeatCount } from "./assignment";
import type { ModuleAddOn, OrgPlanAssignment, Plan, Seat } from "./models";
import type { StripeEnvStatus } from "./stripe";
import { BILLING_TODOS } from "./todos";
import type { BillingTodoId } from "./todos";

export type PlansSettingsScreen = {
  route: "/billing";
  title: "Plans";
  description: string;
  denied: boolean;
  canManage: boolean;
  current: {
    planId: string;
    key: string;
    name: string;
    price: string;
    seatsUsed: number;
    seatLimit: number;
    modules: readonly string[];
  } | null;
  seats: readonly { id: string; holder: string; status: Seat["status"] }[];
  addOns: readonly {
    id: string;
    moduleId: string;
    price: string;
    active: boolean;
    includedInPlan: boolean;
  }[];
  choices: readonly { planId: string; label: string; current: boolean }[];
  stripe: {
    enabled: boolean;
    webhookSecretSet: boolean;
    publishableKeySet: boolean;
    detail: string;
  };
  upcoming: readonly { id: BillingTodoId; summary: string }[];
  error: string | null;
};

export function formatMonthlyPrice(cents: number): string {
  const dollars = Math.trunc(cents / 100);
  const remainder = Math.abs(cents % 100);
  return `$${dollars}.${String(remainder).padStart(2, "0")} / month`;
}

function holder(seat: Seat): string {
  if (seat.userId) return seat.userId;
  if (seat.status === "invited") return "Invited";
  return "Released";
}

function stripeDetail(status: StripeEnvStatus): string {
  if (!status.secretKey) {
    return "Stripe is off until STRIPE_SECRET_KEY is set. No request is sent.";
  }
  return "STRIPE_SECRET_KEY is set. Customer and checkout calls can reach Stripe. Webhook verification is not implemented.";
}

function choiceLabel(item: Plan): string {
  return `${item.name} (${item.key}) · ${formatMonthlyPrice(item.monthlyPriceCents)} · ${item.seatLimit} seats`;
}

const hiddenStripe = {
  enabled: false,
  webhookSecretSet: false,
  publishableKeySet: false,
  detail: "",
};

/**
 * Plan management for platform staff. Visible only when the admin console exists
 * and the staff role has `platform.plans.manage` (super admin and billing).
 */
export function staffPlanManagementVisible(adminConsoleExists: boolean, role: PlatformRole | null): boolean {
  return adminConsoleExists && platformCan(role, PLATFORM_PERMISSIONS.managePlans);
}

export function buildPlansSettingsScreen(input: {
  canRead: boolean;
  canManage: boolean;
  catalog: readonly Plan[];
  assignment: OrgPlanAssignment | null;
  stripe: StripeEnvStatus;
  error?: string | null;
}): PlansSettingsScreen {
  if (!input.canRead) {
    return {
      route: "/billing",
      title: "Plans",
      description: "You do not have access to billing.",
      denied: true,
      canManage: false,
      current: null,
      seats: [],
      addOns: [],
      choices: [],
      stripe: hiddenStripe,
      upcoming: [],
      error: null,
    };
  }

  const currentPlan = input.assignment
    ? input.catalog.find((item) => item.id === input.assignment?.planId) ?? null
    : null;
  const modules = currentPlan?.moduleIds ?? [];
  const seats = input.assignment?.seats ?? [];
  const addOns: ModuleAddOn[] = input.assignment ? [...input.assignment.addOns] : [];

  return {
    route: "/billing",
    title: "Plans",
    description: "The organization plan, seats, and module add-ons.",
    denied: false,
    canManage: input.canManage,
    current: input.assignment
      ? {
          planId: input.assignment.planId,
          key: currentPlan?.key ?? "",
          name: currentPlan?.name ?? "Unknown plan",
          price: currentPlan ? formatMonthlyPrice(currentPlan.monthlyPriceCents) : "—",
          seatsUsed: occupiedSeatCount(seats),
          seatLimit: input.assignment.seatLimit,
          modules,
        }
      : null,
    seats: seats.map((seat) => ({ id: seat.id, holder: holder(seat), status: seat.status })),
    addOns: addOns.map((addOn) => ({
      id: addOn.id,
      moduleId: addOn.moduleId,
      price: formatMonthlyPrice(addOn.monthlyPriceCents),
      active: addOn.active,
      includedInPlan: modules.includes(addOn.moduleId),
    })),
    choices: input.canManage
      ? input.catalog.map((item) => ({
          planId: item.id,
          label: choiceLabel(item),
          current: item.id === input.assignment?.planId,
        }))
      : [],
    stripe: {
      enabled: input.stripe.secretKey,
      webhookSecretSet: input.stripe.webhookSecret,
      publishableKeySet: input.stripe.publishableKey,
      detail: stripeDetail(input.stripe),
    },
    upcoming: BILLING_TODOS.map((todo) => ({ id: todo.id, summary: todo.summary })),
    error: input.error ?? null,
  };
}
