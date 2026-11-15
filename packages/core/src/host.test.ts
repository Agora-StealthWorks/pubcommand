import { describe, expect, it } from "vitest";
import { buildSiteUrl, resolveSite, safeNextUrl } from "./host";

describe("resolveSite", () => {
  it("maps production hosts", () => {
    expect(resolveSite("pubcommand.com", "pubcommand.com").kind).toBe("marketing");
    expect(resolveSite("www.pubcommand.com", "pubcommand.com").kind).toBe("marketing");
    expect(resolveSite("app.pubcommand.com", "pubcommand.com").kind).toBe("app");
    expect(resolveSite("admin.pubcommand.com", "pubcommand.com").kind).toBe("admin");
    expect(resolveSite("agora.pubcommand.com", "pubcommand.com")).toEqual({ kind: "org", slug: "agora" });
    expect(resolveSite("Agora.PubCommand.com:443", "pubcommand.com")).toEqual({ kind: "org", slug: "agora" });
  });

  it("does not let a query string override a production host", () => {
    const search = new URLSearchParams("org=other");
    expect(resolveSite("agora.pubcommand.com", "pubcommand.com", search)).toEqual({
      kind: "org",
      slug: "agora",
    });
  });

  it("supports localhost query fallback and slug.localhost", () => {
    expect(resolveSite("localhost:3000", "localhost", new URLSearchParams("org=agora"))).toEqual({
      kind: "org",
      slug: "agora",
    });
    expect(resolveSite("localhost:3000", "pubcommand.com", new URLSearchParams("site=admin")).kind).toBe("admin");
    expect(resolveSite("localhost:3000", "pubcommand.com").kind).toBe("marketing");
    expect(resolveSite("agora.localhost:3000", "pubcommand.com")).toEqual({ kind: "org", slug: "agora" });
    expect(resolveSite("admin.localhost", "pubcommand.com").kind).toBe("admin");
  });

  it("rejects unknown hosts", () => {
    expect(resolveSite("evil.example", "pubcommand.com").kind).toBe("unknown");
    expect(resolveSite("a.b.pubcommand.com", "pubcommand.com").kind).toBe("unknown");
  });
});

describe("buildSiteUrl", () => {
  it("builds production and local urls", () => {
    expect(
      buildSiteUrl({
        rootDomain: "pubcommand.com",
        requestHost: "pubcommand.com",
        site: { kind: "org", slug: "agora" },
        pathname: "/promo-studio",
      }),
    ).toBe("https://agora.pubcommand.com/promo-studio");
    expect(
      buildSiteUrl({
        rootDomain: "pubcommand.com",
        requestHost: "localhost:3000",
        site: { kind: "org", slug: "agora" },
        pathname: "/knowledge",
      }),
    ).toBe("http://localhost:3000/knowledge?org=agora");
    expect(
      buildSiteUrl({
        rootDomain: "pubcommand.com",
        requestHost: "localhost:3000",
        site: { kind: "admin" },
        pathname: "/",
      }),
    ).toBe("http://localhost:3000/?site=admin");
  });
});

describe("safeNextUrl", () => {
  it("allows same-site urls and relative paths only", () => {
    expect(safeNextUrl("/knowledge", "pubcommand.com")).toBe("/knowledge");
    expect(safeNextUrl("https://agora.pubcommand.com/forms", "pubcommand.com")).toBe(
      "https://agora.pubcommand.com/forms",
    );
    expect(safeNextUrl("https://evil.example/phish", "pubcommand.com")).toBeNull();
    expect(safeNextUrl("//evil.example", "pubcommand.com")).toBeNull();
  });
});
