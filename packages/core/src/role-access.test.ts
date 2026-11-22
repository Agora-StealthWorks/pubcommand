import { describe, expect, it } from "vitest";
import { classifyPermissions } from "./member-access";
import type { ModuleManifest } from "./modules";
import {
  roleAppLevel,
  roleAppLevelOptions,
  roleAppLevelPermissions,
  roleGrantChangeBlocked,
  roleGrantChanges,
  type RoleAppLevel,
} from "./role-access";

function manifest(id: string, permissions: ModuleManifest["permissions"]): ModuleManifest {
  return { id, slug: id, name: id, description: "", nav: [], routes: [], permissions, events: [], jobs: [], settingsSchema: {}, planEntitlement: id };
}

const classified = classifyPermissions([
  manifest("wiki", [{ key: "wiki.read", description: "" }]),
  manifest("websites", [
    { key: "websites.read", description: "" },
    { key: "websites.write", description: "" },
    { key: "websites.publish", description: "" },
    { key: "websites.members", description: "" },
    { key: "websites.settings", description: "", access: "admin" },
  ]),
  manifest("editorial", [
    { key: "editorial.read", description: "" },
    { key: "editorial.write", description: "" },
    { key: "editorial.publish", description: "" },
  ]),
  manifest("pubsetup", [{ key: "pubsetup.manage", description: "", access: "admin" }]),
]);

const has = (keys: string[]) => (key: string) => keys.includes(key);

describe("roleAppLevelOptions", () => {
  it("offers only levels that differ", () => {
    expect(roleAppLevelOptions("wiki", classified)).toEqual(["NONE", "VIEW"]);
    expect(roleAppLevelOptions("editorial", classified)).toEqual(["NONE", "VIEW", "EDIT"]);
    expect(roleAppLevelOptions("websites", classified)).toEqual(["NONE", "VIEW", "EDIT", "MANAGE"]);
    expect(roleAppLevelOptions("pubsetup", classified)).toEqual(["NONE", "MANAGE"]);
    expect(roleAppLevelOptions("unknown", classified)).toEqual([]);
  });
});

describe("roleAppLevelPermissions ⇄ roleAppLevel", () => {
  it("maps each level to the app's read / write / admin permissions", () => {
    expect(roleAppLevelPermissions("websites", "NONE", classified)).toEqual([]);
    expect(roleAppLevelPermissions("websites", "VIEW", classified)).toEqual(["websites.read"]);
    expect(roleAppLevelPermissions("websites", "EDIT", classified)).toEqual(["websites.members", "websites.publish", "websites.read", "websites.write"]);
    expect(roleAppLevelPermissions("websites", "MANAGE", classified)).toHaveLength(5);
  });

  it("round-trips every offered level", () => {
    for (const moduleId of ["wiki", "websites", "editorial", "pubsetup"]) {
      for (const level of roleAppLevelOptions(moduleId, classified)) {
        expect(roleAppLevel(moduleId, has(roleAppLevelPermissions(moduleId, level as RoleAppLevel, classified)), classified)).toBe(level);
      }
    }
  });

  it("reads a mixed set as CUSTOM and ignores other apps' permissions", () => {
    expect(roleAppLevel("websites", has(["websites.read", "websites.write", "websites.publish"]), classified)).toBe("CUSTOM");
    expect(roleAppLevel("websites", has(["websites.write"]), classified)).toBe("CUSTOM");
    expect(roleAppLevel("editorial", has(["websites.read", "wiki.read"]), classified)).toBe("NONE");
    expect(roleAppLevel("editorial", has(["editorial.read"]), classified)).toBe("VIEW");
  });
});

describe("roleGrantChanges", () => {
  it("diffs only within the section", () => {
    expect(
      roleGrantChanges({
        current: ["editorial.read", "editorial.write", "wiki.read"],
        desired: ["editorial.read", "editorial.publish", "settings.roles.manage"],
        sectionKeys: ["editorial.read", "editorial.write", "editorial.publish"],
      }),
    ).toEqual({ add: ["editorial.publish"], remove: ["editorial.write"] });
  });

  it("does nothing when nothing changed", () => {
    expect(roleGrantChanges({ current: ["a"], desired: ["a"], sectionKeys: ["a", "b"] })).toEqual({ add: [], remove: [] });
  });
});

describe("roleGrantChangeBlocked", () => {
  it("never edits the Owner", () => {
    expect(roleGrantChangeBlocked({ roleSlug: "owner", isActorsRole: false, remove: [] })).toMatch(/Owner/);
  });

  it("stops admins removing their own user / role management", () => {
    expect(roleGrantChangeBlocked({ roleSlug: "admin", isActorsRole: true, remove: ["settings.roles.manage"] })).toMatch(/your own role/);
    expect(roleGrantChangeBlocked({ roleSlug: "admin", isActorsRole: true, remove: ["settings.users.manage"] })).toMatch(/your own role/);
    expect(roleGrantChangeBlocked({ roleSlug: "admin", isActorsRole: true, remove: ["settings.audit.read"] })).toBeNull();
    expect(roleGrantChangeBlocked({ roleSlug: "admin", isActorsRole: false, remove: ["settings.roles.manage"] })).toBeNull();
  });
});
