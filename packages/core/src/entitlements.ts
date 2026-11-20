/**
 * Which apps (modules) an organization may use.
 *
 *   allowed  = platform override ?? plan        (decided by PubCommand staff)
 *   entitled = allowed AND the org's own on/off  (decided by the org admin in Settings → Apps)
 *
 * Always-on modules (the Settings shell) are entitled for every organization and
 * can be neither blocked by staff nor switched off by the org.
 */

export const ALWAYS_ON_MODULE_IDS: readonly string[] = ["settings"];

export type AppAccessOverride = "ALLOWED" | "BLOCKED";

export type EntitlementInput = {
  planModuleIds: readonly string[];
  /** Staff overrides for this organization only: moduleId → ALLOWED | BLOCKED. */
  overrides: Readonly<Record<string, AppAccessOverride>>;
  /** The org admin's switches (organization_modules): moduleId → enabled. Missing means on. */
  toggles: Readonly<Record<string, boolean>>;
};

export function isAlwaysOnModule(moduleId: string): boolean {
  return ALWAYS_ON_MODULE_IDS.includes(moduleId);
}

/** Does PubCommand allow this org to use the module (before the org's own switch)? */
export function moduleAllowed(moduleId: string, input: Pick<EntitlementInput, "planModuleIds" | "overrides">): boolean {
  if (isAlwaysOnModule(moduleId)) return true;
  const override = input.overrides[moduleId];
  if (override === "BLOCKED") return false;
  if (override === "ALLOWED") return true;
  return input.planModuleIds.includes(moduleId);
}

/** Every module the org is allowed by staff/plan. */
export function allowedModuleIds(input: Pick<EntitlementInput, "planModuleIds" | "overrides">): string[] {
  const candidates = new Set<string>([...ALWAYS_ON_MODULE_IDS, ...input.planModuleIds, ...Object.keys(input.overrides)]);
  return [...candidates].filter((moduleId) => moduleAllowed(moduleId, input)).sort();
}

/** The entitled module ids every guard, nav item, dashboard card, job and API reads. */
export function effectiveModuleIds(input: EntitlementInput): string[] {
  return allowedModuleIds(input).filter((moduleId) => isAlwaysOnModule(moduleId) || input.toggles[moduleId] !== false);
}

/**
 * The platform super admin may open any organization without a plan, but staff
 * blocks and the org's own switches still apply: they see what the org has.
 */
export function superAdminModuleIds(allModuleIds: readonly string[], input: Pick<EntitlementInput, "overrides" | "toggles">): string[] {
  return effectiveModuleIds({ planModuleIds: allModuleIds, overrides: input.overrides, toggles: input.toggles });
}

export type AppAccessChoice = "PLAN" | AppAccessOverride;

/** Plain label for the admin console. */
export function appAccessSummary(moduleId: string, input: Pick<EntitlementInput, "planModuleIds" | "overrides">) {
  const onPlan = input.planModuleIds.includes(moduleId);
  const override = input.overrides[moduleId] ?? null;
  const choice: AppAccessChoice = override ?? "PLAN";
  return { alwaysOn: isAlwaysOnModule(moduleId), onPlan, choice, allowed: moduleAllowed(moduleId, input) };
}

export function parseAppAccessChoice(value: string): AppAccessChoice | null {
  return value === "PLAN" || value === "ALLOWED" || value === "BLOCKED" ? value : null;
}
