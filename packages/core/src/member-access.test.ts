import { describe, expect, it } from "vitest";
import {
  adjustableModule,
  builtInRolePermissions,
  classifyPermissions,
  defaultMemberRoleId,
  effectiveAppLevel,
  memberAccessChangeBlocked,
  memberAppAccessRules,
  permissionAccess,
} from "./member-access";
import type { ModuleManifest } from "./modules";
import { can, type AccessSubject } from "./permissions";

function manifest(id: string, permissions: ModuleManifest["permissions"]): ModuleManifest {
  return { id, slug: id, name: id, description: "", nav: [], routes: [], permissions, events: [], jobs: [], settingsSchema: {}, planEntitlement: id };
}

const manifests = [
  manifest("wiki", [{ key: "wiki.read", description: "" }]),
  manifest("websites", [
    { key: "websites.read", description: "" },
    { key: "websites.write", description: "" },
    { key: "websites.publish", description: "" },
    { key: "websites.members", description: "" },
  ]),
  manifest("charts", [
    { key: "charts.read", description: "", access: "write" },
    { key: "charts.write", description: "" },
  ]),
  manifest("settings", [{ key: "settings.audit.read", description: "", access: "admin" }]),
];
const classified = classifyPermissions(manifests);

function subject(grants: string[], extra?: { levels?: Record<string, "NONE" | "VIEW" | "EDIT">; entitled?: string[] }): AccessSubject {
  const rules = memberAppAccessRules({ userId: "u1", levels: extra?.levels ?? {}, classified });
  return {
    userId: "u1",
    organizationId: "o",
    roleId: "role",
    membershipBrandId: null,
    membershipWorkspaceId: null,
    grants: [...grants.map((permission) => ({ permission, effect: "allow" as const, brandId: null, workspaceId: null, roleId: "role" })), ...rules.grants],
    exclusions: rules.exclusions,
    entitledModuleIds: extra?.entitled ?? ["wiki", "websites", "charts", "settings"],
    permissionModules: Object.fromEntries(classified.map((permission) => [permission.key, permission.moduleId])),
  };
}
const scope = { organizationId: "o" };

describe("read/write classification", () => {
  it("uses the manifest flag first, then the key", () => {
    expect(permissionAccess({ key: "wiki.read", description: "" })).toBe("read");
    expect(permissionAccess({ key: "example.view", description: "" })).toBe("read");
    expect(permissionAccess({ key: "websites.publish", description: "" })).toBe("write");
    expect(permissionAccess({ key: "charts.read", description: "", access: "write" })).toBe("write");
    expect(permissionAccess({ key: "settings.audit.read", description: "", access: "admin" })).toBe("admin");
  });
});

describe("built-in roles", () => {
  it("User gets only read permissions", () => {
    expect(builtInRolePermissions("user", manifests)).toEqual(["websites.read", "wiki.read"]);
  });
  it("Editor adds website writing, not publishing, members or settings", () => {
    expect(builtInRolePermissions("editor", manifests)).toEqual(["websites.read", "websites.write", "wiki.read"]);
  });
  it("new members default to User", () => {
    expect(defaultMemberRoleId([{ id: "a", slug: "admin" }, { id: "u", slug: "user" }, { id: "e", slug: "editor" }])).toBe("u");
    expect(defaultMemberRoleId([{ id: "a", slug: "owner" }, { id: "x", slug: "analyst" }])).toBe("x");
  });
});

describe("per-member app access", () => {
  it("role default applies when there is no override", () => {
    const s = subject(["wiki.read", "websites.read"]);
    expect(can(s, "websites.read", scope)).toBe(true);
    expect(can(s, "websites.write", scope)).toBe(false);
  });
  it("EDIT raises a read-only member to the app's write permissions", () => {
    const s = subject(["websites.read"], { levels: { websites: "EDIT" } });
    expect(can(s, "websites.write", scope)).toBe(true);
    expect(can(s, "websites.publish", scope)).toBe(true);
    expect(effectiveAppLevel("websites", (p) => can(s, p, scope), classified)).toBe("EDIT");
  });
  it("VIEW lowers an editor to read-only for that app", () => {
    const s = subject(["websites.read", "websites.write"], { levels: { websites: "VIEW" } });
    expect(can(s, "websites.read", scope)).toBe(true);
    expect(can(s, "websites.write", scope)).toBe(false);
  });
  it("NONE removes the app even when the role grants it", () => {
    const s = subject(["wiki.read"], { levels: { wiki: "NONE" } });
    expect(can(s, "wiki.read", scope)).toBe(false);
    expect(effectiveAppLevel("wiki", (p) => can(s, p, scope), classified)).toBe("NONE");
  });
  it("an override never reaches past the org's entitlement", () => {
    const s = subject([], { levels: { charts: "EDIT" }, entitled: ["wiki", "settings"] });
    expect(can(s, "charts.read", scope)).toBe(false);
  });
  it("EDIT never grants admin-level permissions", () => {
    expect(memberAppAccessRules({ userId: "u1", levels: { settings: "EDIT" }, classified }).grants).toEqual([]);
    expect(adjustableModule("settings", classified)).toBe(false);
    expect(adjustableModule("wiki", classified)).toBe(true);
  });
  it("guards: nobody changes their own access, and only entitled, adjustable apps", () => {
    expect(memberAccessChangeBlocked({ actorUserId: "a", targetUserId: "a", moduleEntitled: true, moduleAdjustable: true })).toMatch(/own/);
    expect(memberAccessChangeBlocked({ actorUserId: "a", targetUserId: "b", moduleEntitled: false, moduleAdjustable: true })).toMatch(/does not have/);
    expect(memberAccessChangeBlocked({ actorUserId: "a", targetUserId: "b", moduleEntitled: true, moduleAdjustable: false })).toMatch(/role only/);
    expect(memberAccessChangeBlocked({ actorUserId: "a", targetUserId: "b", moduleEntitled: true, moduleAdjustable: true })).toBeNull();
  });
});
