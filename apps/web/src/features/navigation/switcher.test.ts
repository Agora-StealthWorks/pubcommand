import { describe, expect, it } from "vitest";
import { buildSwitcher, switcherPaletteItems } from "./switcher";

const orgs = [
  { slug: "example-gazette", name: "Example Gazette" },
  { slug: "example-harbor", name: "Example Harbor" },
];

describe("site switcher", () => {
  it("inside an organization: lists every org, the console for staff, and Your account here", () => {
    const model = buildSwitcher({
      here: { kind: "org", slug: "example-gazette", name: "Example Gazette" },
      organizations: orgs,
      staff: { ready: true },
      rootDomain: "pubcommand.com",
      requestHost: "example-gazette.pubcommand.com",
    });
    expect(model.currentLabel).toBe("Example Gazette");
    expect(model.organizations).toEqual([
      { key: "org:example-gazette", label: "Example Gazette", href: "/", current: true },
      { key: "org:example-harbor", label: "Example Harbor", href: "https://example-harbor.pubcommand.com", current: false },
    ]);
    expect(model.console?.href).toBe("https://admin.pubcommand.com");
    expect(model.account?.href).toBe("/account");
    expect(model.chooser?.href).toBe("https://app.pubcommand.com");
  });

  it("in the console: the console is current and Your account goes to the first organization", () => {
    const model = buildSwitcher({ here: { kind: "admin" }, organizations: orgs, staff: { ready: true }, rootDomain: "pubcommand.com", requestHost: "admin.pubcommand.com" });
    expect(model.currentLabel).toBe("Platform console");
    expect(model.console).toMatchObject({ href: "/", current: true });
    expect(model.organizations.every((org) => !org.current && org.href.startsWith("https://"))).toBe(true);
    expect(model.account?.href).toBe("https://example-gazette.pubcommand.com/account");
    expect(switcherPaletteItems(model).map((item) => item.label)).toEqual([
      "Example Gazette",
      "Example Harbor",
      "All workspaces",
      "Your account (password, name)",
    ]);
  });

  it("hides the console from non-staff and sends unfinished staff to two-factor", () => {
    const base = { here: { kind: "app" as const }, organizations: orgs, rootDomain: "pubcommand.com", requestHost: "app.pubcommand.com" };
    expect(buildSwitcher({ ...base, staff: null }).console).toBeNull();
    expect(buildSwitcher({ ...base, staff: { ready: false } }).console?.href).toBe("https://admin.pubcommand.com/2fa");
  });

  it("uses local hosts in development and has no account link without an organization", () => {
    const model = buildSwitcher({ here: { kind: "admin" }, organizations: [], staff: { ready: true }, rootDomain: "localhost", requestHost: "localhost:3159" });
    expect(model.account).toBeNull();
    expect(model.chooser).toBeNull();
    const local = buildSwitcher({ here: { kind: "admin" }, organizations: orgs.slice(0, 1), staff: { ready: true }, rootDomain: "localhost", requestHost: "localhost:3159" });
    expect(local.organizations[0]!.href).toBe("http://localhost:3159/?org=example-gazette");
    expect(local.chooser).toBeNull();
  });

  it("marks organizations the super admin opens without being a member", () => {
    const model = buildSwitcher({
      here: { kind: "admin" },
      organizations: [orgs[0]!, { ...orgs[1]!, member: false }],
      staff: { ready: true },
      rootDomain: "pubcommand.com",
      requestHost: "admin.pubcommand.com",
    });
    expect(model.organizations.map((org) => org.hint)).toEqual([undefined, "Super admin access"]);
  });
});
