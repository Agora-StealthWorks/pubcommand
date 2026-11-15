export class BillingModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingModelError";
  }
}

export type Plan = {
  id: string;
  key: string;
  name: string;
  seatLimit: number;
  monthlyPriceCents: number;
  moduleIds: readonly string[];
};

export type SeatStatus = "assigned" | "invited" | "released";

export type Seat = {
  id: string;
  organizationId: string;
  userId: string | null;
  status: SeatStatus;
};

export type ModuleAddOn = {
  id: string;
  organizationId: string;
  moduleId: string;
  monthlyPriceCents: number;
  active: boolean;
};

export type OrgPlanAssignment = {
  organizationId: string;
  planId: string;
  seatLimit: number;
  seats: readonly Seat[];
  addOns: readonly ModuleAddOn[];
};

const SEAT_STATUSES: readonly SeatStatus[] = ["assigned", "invited", "released"];

function requiredText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new BillingModelError(`${label} is required`);
  return trimmed;
}

function nonNegativeInt(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new BillingModelError(`${label} must be a non-negative integer`);
  }
  return value;
}

function uniqueIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

export function createPlan(input: {
  id: string;
  key: string;
  name: string;
  seatLimit: number;
  monthlyPriceCents: number;
  moduleIds: readonly string[];
}): Plan {
  return {
    id: requiredText(input.id, "Plan id"),
    key: requiredText(input.key, "Plan key"),
    name: requiredText(input.name, "Plan name"),
    seatLimit: nonNegativeInt(input.seatLimit, "Plan seatLimit"),
    monthlyPriceCents: nonNegativeInt(input.monthlyPriceCents, "Plan monthlyPriceCents"),
    moduleIds: uniqueIds(input.moduleIds),
  };
}

export function createSeat(input: {
  id: string;
  organizationId: string;
  userId: string | null;
  status: SeatStatus;
}): Seat {
  if (!SEAT_STATUSES.includes(input.status)) {
    throw new BillingModelError("Seat status must be assigned, invited, or released");
  }
  const userId = input.userId?.trim() || null;
  if (input.status === "assigned" && !userId) {
    throw new BillingModelError("An assigned seat needs a user");
  }
  return {
    id: requiredText(input.id, "Seat id"),
    organizationId: requiredText(input.organizationId, "Seat organizationId"),
    userId,
    status: input.status,
  };
}

export function createModuleAddOn(input: {
  id: string;
  organizationId: string;
  moduleId: string;
  monthlyPriceCents: number;
  active: boolean;
}): ModuleAddOn {
  return {
    id: requiredText(input.id, "Add-on id"),
    organizationId: requiredText(input.organizationId, "Add-on organizationId"),
    moduleId: requiredText(input.moduleId, "Add-on moduleId"),
    monthlyPriceCents: nonNegativeInt(input.monthlyPriceCents, "Add-on monthlyPriceCents"),
    active: input.active,
  };
}
