import { describe, expect, it } from "vitest";
import { can, type AccessSubject } from "./permissions";

function subject(overrides: Partial<AccessSubject> = {}): AccessSubject {
  return {
    userId: "user-a",
    organizationId: "org-a",
    roleId: "role-editor",
    membershipBrandId: null,
    membershipWorkspaceId: null,
    grants: [
      {
        permission: "promo.approve",
        effect: "allow",
        brandId: null,
        workspaceId: null,
        roleId: "role-editor",
      },
    ],
    exclusions: [],
    entitledModuleIds: ["promo-studio"],
    permissionModules: { "promo.approve": "promo-studio", "forms.export": "forms" },
    ...overrides,
  };
}

const scope = { organizationId: "org-a", brandId: "brand-a", workspaceId: "ws-a" };

describe("can", () => {
  it("allows a granted permission when the plan entitles the module", () => {
    expect(can(subject(), "promo.approve", scope)).toBe(true);
  });

  it("rejects an unknown permission", () => {
    expect(can(subject(), "missing.permission", scope)).toBe(false);
  });

  it("rejects a module the plan does not entitle", () => {
    expect(can(subject({ entitledModuleIds: ["knowledge"] }), "promo.approve", scope)).toBe(false);
  });

  it("rejects a user exclusion and ignores an exclusion for someone else", () => {
    const blocked = subject({
      exclusions: [
        {
          permission: "promo.approve",
          userId: "user-a",
          roleId: null,
          brandId: null,
          workspaceId: null,
        },
      ],
    });
    expect(can(blocked, "promo.approve", scope)).toBe(false);
    const other = subject({
      exclusions: [
        {
          permission: "promo.approve",
          userId: "user-b",
          roleId: null,
          brandId: null,
          workspaceId: null,
        },
      ],
    });
    expect(can(other, "promo.approve", scope)).toBe(true);
  });

  it("lets a deny grant beat an allow grant", () => {
    const denied = subject({
      grants: [
        { permission: "promo.approve", effect: "allow", brandId: null, workspaceId: null, roleId: "role-editor" },
        { permission: "promo.approve", effect: "deny", brandId: "brand-a", workspaceId: null, roleId: "role-editor" },
      ],
    });
    expect(can(denied, "promo.approve", scope)).toBe(false);
    expect(can(denied, "promo.approve", { organizationId: "org-a", brandId: "brand-b" })).toBe(true);
  });

  it("keeps a brand grant inside that brand and lets an org grant cover a workspace", () => {
    const brandOnly = subject({
      grants: [
        { permission: "promo.approve", effect: "allow", brandId: "brand-a", workspaceId: null, roleId: "role-editor" },
      ],
    });
    expect(can(brandOnly, "promo.approve", scope)).toBe(true);
    expect(can(brandOnly, "promo.approve", { organizationId: "org-a", brandId: "brand-b" })).toBe(false);
    expect(can(brandOnly, "promo.approve", { organizationId: "org-a" })).toBe(false);
    expect(can(subject(), "promo.approve", scope)).toBe(true);
  });

  it("rejects a workspace grant for an org-wide request", () => {
    const workspaceOnly = subject({
      grants: [
        {
          permission: "promo.approve",
          effect: "allow",
          brandId: null,
          workspaceId: "ws-a",
          roleId: "role-editor",
        },
      ],
    });
    expect(can(workspaceOnly, "promo.approve", { organizationId: "org-a" })).toBe(false);
    expect(can(workspaceOnly, "promo.approve", scope)).toBe(true);
  });

  it("rejects another organization and a membership scoped to another brand", () => {
    expect(can(subject(), "promo.approve", { organizationId: "org-b", brandId: "brand-a" })).toBe(false);
    const brandMember = subject({ membershipBrandId: "brand-a" });
    expect(can(brandMember, "promo.approve", { organizationId: "org-a", brandId: "brand-b" })).toBe(false);
    expect(can(brandMember, "promo.approve", { organizationId: "org-a" })).toBe(false);
    expect(can(brandMember, "promo.approve", scope)).toBe(true);
  });
});
