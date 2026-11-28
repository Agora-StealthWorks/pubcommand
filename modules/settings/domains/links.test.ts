import { describe, expect, it } from "vitest";
import { customDomainUrl } from "./links";
import { decideCustomHost } from "./routing";

const domains = [
  { hostname: "Maha-Link.com", targetPath: "/b/digest" },
  { hostname: "survey.example.com", targetPath: "/f/reader-survey" },
  { hostname: "launch.example.com", targetPath: "/l/launch" },
  { hostname: "site.example.com", targetPath: "/w/club" },
  { hostname: "members.example.com", targetPath: "/w/club/my" },
];

describe("customDomainUrl", () => {
  it("maps the target and pages under it to the domain root", () => {
    expect(customDomainUrl(domains, "/b/digest")).toBe("https://maha-link.com/");
    expect(customDomainUrl(domains, "/b/digest/morning-note")).toBe("https://maha-link.com/morning-note");
    expect(customDomainUrl(domains, "/b/digest/morning-note?preview=1&pv=abc")).toBe("https://maha-link.com/morning-note?preview=1&pv=abc");
    expect(customDomainUrl(domains, "/l/launch/day-2")).toBe("https://launch.example.com/day-2");
  });

  it("uses the old /t/ path and form embeds through their aliases", () => {
    expect(customDomainUrl(domains, "/t/digest/morning-note")).toBe("https://maha-link.com/t/digest/morning-note");
    expect(customDomainUrl(domains, "/embed/reader-survey")).toBe("https://survey.example.com/embed/reader-survey");
  });

  it("keeps the full path when the rest would read as a public prefix", () => {
    expect(customDomainUrl(domains, "/b/digest/f")).toBe("https://maha-link.com/b/digest/f");
    expect(customDomainUrl(domains, "/b/digest/api")).toBe("https://maha-link.com/b/digest/api");
  });

  it("prefers the most specific domain", () => {
    expect(customDomainUrl(domains, "/w/club/my/account")).toBe("https://members.example.com/account");
    expect(customDomainUrl(domains, "/w/club/news")).toBe("https://site.example.com/news");
  });

  it("returns null when no domain serves the page", () => {
    expect(customDomainUrl(domains, "/b/other")).toBeNull();
    expect(customDomainUrl(domains, "/b/digestive")).toBeNull();
    expect(customDomainUrl([], "/b/digest")).toBeNull();
  });

  it("every URL it builds is served as that page by the custom domain", () => {
    const cases: [string, string][] = [
      ["/b/digest/morning-note", "/b/digest/morning-note"],
      ["/b/digest/f", "/b/digest/f"],
      ["/embed/reader-survey", "/embed/reader-survey"],
      ["/w/club/my/account", "/w/club/my/account"],
    ];
    for (const [path, publicPath] of cases) {
      const url = new URL(customDomainUrl(domains, path)!);
      const domain = domains.find((item) => item.hostname.toLowerCase() === url.hostname)!;
      expect(decideCustomHost({ pathname: url.pathname, orgSlug: "org", targetPath: domain.targetPath })).toMatchObject({ kind: "rewrite", publicPath });
    }
  });
});
