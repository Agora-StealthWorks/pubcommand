import { describe, expect, it } from "vitest";
import { allowedModuleIds, appAccessSummary, effectiveModuleIds, moduleAllowed, superAdminModuleIds } from "./entitlements";
import { can, type AccessSubject } from "./permissions";

const plan = ["knowledge", "editorial", "forms"];

describe("entitlement merging", () => {
  it("follows the plan when there is no override", () => {
    expect(effectiveModuleIds({ planModuleIds: plan, overrides: {}, toggles: {} })).toEqual(["editorial", "forms", "knowledge", "settings"]);
  });

  it("an override beats the plan both ways", () => {
    const ids = effectiveModuleIds({ planModuleIds: plan, overrides: { forms: "BLOCKED", charts: "ALLOWED" }, toggles: {} });
    expect(ids).toContain("charts");
    expect(ids).not.toContain("forms");
    expect(moduleAllowed("forms", { planModuleIds: plan, overrides: { forms: "ALLOWED" } })).toBe(true);
  });

  it("the org's own switch can turn an allowed app off, but never turn on one that is not allowed", () => {
    const ids = effectiveModuleIds({ planModuleIds: plan, overrides: { charts: "ALLOWED" }, toggles: { charts: false, intel: true } });
    expect(ids).not.toContain("charts");
    expect(ids).not.toContain("intel");
  });

  it("settings is always on: it cannot be blocked or switched off", () => {
    const ids = effectiveModuleIds({ planModuleIds: [], overrides: { settings: "BLOCKED" }, toggles: { settings: false } });
    expect(ids).toEqual(["settings"]);
    expect(appAccessSummary("settings", { planModuleIds: [], overrides: {} }).alwaysOn).toBe(true);
  });

  it("allowed ids ignore the org's switch", () => {
    expect(allowedModuleIds({ planModuleIds: plan, overrides: { knowledge: "BLOCKED" } })).toEqual(["editorial", "forms", "settings"]);
  });

  it("the super admin sees every app except staff blocks and org switches", () => {
    const ids = superAdminModuleIds(["knowledge", "charts", "forms", "settings"], { overrides: { charts: "BLOCKED" }, toggles: { forms: false } });
    expect(ids).toEqual(["knowledge", "settings"]);
  });

  it("can() denies a blocked app's permissions even when the role grants them", () => {
    const entitled = effectiveModuleIds({ planModuleIds: plan, overrides: { forms: "BLOCKED" }, toggles: {} });
    const subject: AccessSubject = {
      userId: "u",
      organizationId: "o",
      roleId: "r",
      membershipBrandId: null,
      membershipWorkspaceId: null,
      grants: [
        { permission: "forms.read", effect: "allow", brandId: null, workspaceId: null, roleId: "r" },
        { permission: "knowledge.read", effect: "allow", brandId: null, workspaceId: null, roleId: "r" },
      ],
      exclusions: [],
      entitledModuleIds: entitled,
      permissionModules: { "forms.read": "forms", "knowledge.read": "knowledge" },
    };
    expect(can(subject, "forms.read", { organizationId: "o" })).toBe(false);
    expect(can(subject, "knowledge.read", { organizationId: "o" })).toBe(true);
  });
});
