export const UNLIMITED_PLAN_LIMIT = 1_000_000;

export function isUnlimitedPlanLimit(value: number): boolean {
  return value >= UNLIMITED_PLAN_LIMIT;
}

export function formatPlanLimit(value: number): string {
  return isUnlimitedPlanLimit(value) ? "Unlimited" : String(value);
}

export function formatPlanPrice(cents: number): string {
  if (cents <= 0) return "$0";
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

export function planPriceInput(cents: number): string {
  return (Math.max(0, cents) / 100).toFixed(2);
}

export function planKeyFromName(name: string): string | null {
  const key = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key) || key.length < 2) return null;
  return key;
}

export function parsePlanPrice(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const cents = Math.round(Number(trimmed) * 100);
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > 100_000_000) return null;
  return cents;
}

export type PlanDraftInput = {
  name: string;
  seatLimit: string;
  brandLimit: string;
  workspaceLimit: string;
  monthlyPrice: string;
  seatUnlimited: boolean;
  brandUnlimited: boolean;
  workspaceUnlimited: boolean;
  moduleIds: string[];
};

export type PlanDraft =
  | {
      ok: true;
      name: string;
      key: string;
      seatLimit: number;
      brandLimit: number;
      workspaceLimit: number;
      monthlyPriceCents: number;
      moduleIds: string[];
    }
  | { ok: false; message: string };

function parsedLimit(input: string, unlimited: boolean, label: string): number | { message: string } {
  if (unlimited) return UNLIMITED_PLAN_LIMIT;
  const trimmed = input.trim();
  if (!/^\d+$/.test(trimmed)) return { message: `Enter a ${label} of at least 1.` };
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < 1 || value > UNLIMITED_PLAN_LIMIT) {
    return { message: `Enter a ${label} of at least 1.` };
  }
  return value;
}

export function validatePlanDraft(input: PlanDraftInput, options?: { key?: string }): PlanDraft {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) return { ok: false, message: "Enter a plan name." };
  const key = options?.key ?? planKeyFromName(name);
  if (!key) return { ok: false, message: "Use a plan name with letters or numbers." };
  const seatLimit = parsedLimit(input.seatLimit, input.seatUnlimited, "seat limit");
  if (typeof seatLimit !== "number") return { ok: false, message: seatLimit.message };
  const brandLimit = parsedLimit(input.brandLimit, input.brandUnlimited, "brand limit");
  if (typeof brandLimit !== "number") return { ok: false, message: brandLimit.message };
  const workspaceLimit = parsedLimit(input.workspaceLimit, input.workspaceUnlimited, "workspace limit");
  if (typeof workspaceLimit !== "number") return { ok: false, message: workspaceLimit.message };
  const monthlyPriceCents = parsePlanPrice(input.monthlyPrice);
  if (monthlyPriceCents === null) return { ok: false, message: "Enter a display price like 49 or 49.00." };
  const moduleIds = [...new Set(input.moduleIds.map((id) => id.trim()).filter(Boolean))];
  return { ok: true, name, key, seatLimit, brandLimit, workspaceLimit, monthlyPriceCents, moduleIds };
}

export function defaultPlanChoice<T extends { id: string; key: string }>(plans: readonly T[]): T | null {
  return plans.find((plan) => plan.key === "internal") ?? plans[0] ?? null;
}
