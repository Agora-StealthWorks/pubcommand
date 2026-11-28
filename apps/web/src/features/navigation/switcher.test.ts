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

  it("lists an organization's brands under it, marking the one you work in, and adds them to ⌘K", () => {
    const model = buildSwitcher({
      here: { kind: "org", slug: "example-gazette", name: "Example Gazette", brandId: "b1" },
      organizations: [
        { slug: "example-gazette", name: "Example Gazette", brands: [{ id: "b1", name: "Daily" }, { id: "b2", name: "Weekly" }] },
        { slug: "example-harbor", name: "Example Harbor", brands: [{ id: "b3", name: "Harbor News" }, { id: "b4", name: "Harbor Money" }], member: false },
        { slug: "example-solo", name: "Example Solo", brands: [{ id: "b5", name: "Solo Brand" }] },
      ],
      staff: { ready: true },
      rootDomain: "pubcommand.com",
      requestHost: "example-gazette.pubcommand.com",
    });
    const [gazette, harbor, solo] = model.organizations;
    expect(gazette!.brands).toEqual([
      { key: "brand:example-gazette:b1", label: "Daily", href: "/switch-brand/b1", current: true },
      { key: "brand:example-gazette:b2", label: "Weekly", href: "/switch-brand/b2", current: false },
    ]);
    expect(harbor!.hint).toBe("Super admin access");
    expect(harbor!.brands?.[0]?.href).toBe("https://example-harbor.pubcommand.com/switch-brand/b3");
    // One brand: no sub-list, the brand name is the hint.
    expect(solo!.brands).toBeUndefined();
    expect(solo!.hint).toBe("Solo Brand");
    const brands = switcherPaletteItems(model).filter((item) => item.group === "Brands").map((item) => item.label);
    expect(brands).toEqual(["Example Gazette · Weekly", "Example Harbor · Harbor News", "Example Harbor · Harbor Money"]);
  });
});
