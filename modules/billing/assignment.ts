import { BillingModelError, createModuleAddOn, createPlan, createSeat } from "./models";
import type { ModuleAddOn, OrgPlanAssignment, Plan, Seat } from "./models";

export type AssignPlanCode = "unknown_plan" | "seat_limit" | "foreign_seat" | "foreign_add_on" | "invalid";

export type PlanChangedEvent = {
  name: "billing.plan.changed";
  organizationId: string;
  planId: string;
  seatLimit: number;
};

export type AssignPlanResult =
  | { ok: true; assignment: OrgPlanAssignment; event: PlanChangedEvent }
  | { ok: false; code: AssignPlanCode; message: string };

export function occupiedSeatCount(seats: readonly Seat[]): number {
  return seats.filter((seat) => seat.status === "assigned" || seat.status === "invited").length;
}

function invalid(error: unknown, fallback: string): { ok: false; code: "invalid"; message: string } {
  const message = error instanceof BillingModelError ? error.message : fallback;
  return { ok: false, code: "invalid", message };
}

export function assignOrgPlan(input: {
  organizationId: string;
  planId: string;
  catalog: readonly Plan[];
  seats: readonly Seat[];
  addOns: readonly ModuleAddOn[];
}): AssignPlanResult {
  const organizationId = input.organizationId.trim();
  const planId = input.planId.trim();
  if (!organizationId || !planId) {
    return { ok: false, code: "invalid", message: "Organization and plan are required" };
  }

  const selected = input.catalog.find((item) => item.id === planId);
  if (!selected) {
    return { ok: false, code: "unknown_plan", message: "That plan is not in the catalog." };
  }

  let plan: Plan;
  try {
    plan = createPlan(selected);
  } catch (error) {
    return invalid(error, "That plan is invalid");
  }

  const seats: Seat[] = [];
  const seenSeats = new Set<string>();
  for (const candidate of input.seats) {
    let seat: Seat;
    try {
      seat = createSeat(candidate);
    } catch (error) {
      return invalid(error, "A seat is invalid");
    }
    if (seenSeats.has(seat.id)) {
      return { ok: false, code: "invalid", message: `Seat ${seat.id} is listed more than once` };
    }
    seenSeats.add(seat.id);
    if (seat.organizationId !== organizationId) {
      return { ok: false, code: "foreign_seat", message: `Seat ${seat.id} belongs to another organization.` };
    }
    seats.push(seat);
  }

  const addOns: ModuleAddOn[] = [];
  const seenAddOns = new Set<string>();
  for (const candidate of input.addOns) {
    let addOn: ModuleAddOn;
    try {
      addOn = createModuleAddOn(candidate);
    } catch (error) {
      return invalid(error, "An add-on is invalid");
    }
    if (seenAddOns.has(addOn.id)) {
      return { ok: false, code: "invalid", message: `Add-on ${addOn.id} is listed more than once` };
    }
    seenAddOns.add(addOn.id);
    if (addOn.organizationId !== organizationId) {
      return { ok: false, code: "foreign_add_on", message: `Add-on ${addOn.id} belongs to another organization.` };
    }
    addOns.push(addOn);
  }

  const used = occupiedSeatCount(seats);
  if (used > plan.seatLimit) {
    return {
      ok: false,
      code: "seat_limit",
      message: `This plan includes ${plan.seatLimit} seats and the organization is using ${used}.`,
    };
  }

  return {
    ok: true,
    assignment: {
      organizationId,
      planId: plan.id,
      seatLimit: plan.seatLimit,
      seats,
      addOns,
    },
    event: {
      name: "billing.plan.changed",
      organizationId,
      planId: plan.id,
      seatLimit: plan.seatLimit,
    },
  };
}
