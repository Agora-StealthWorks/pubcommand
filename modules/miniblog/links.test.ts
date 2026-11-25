import { describe, expect, it } from "vitest";
import { clickCounts, extractLinks, isTrackableUrl, postLinks, redirectTarget, rewriteLinks, trackedPath } from "./links";
import { calendarStatusFor, shouldFlipToSent } from "./site";

describe("tracked links", () => {
  it("accepts only absolute http(s) links without credentials", () => {
    expect(isTrackableUrl("https://example.com/a?b=1")).toBe(true);
    expect(isTrackableUrl("http://example.com")).toBe(true);
    expect(isTrackableUrl("javascript:alert(1)")).toBe(false);
    expect(isTrackableUrl("mailto:a@b.co")).toBe(false);
    expect(isTrackableUrl("//evil.example")).toBe(false);
    expect(isTrackableUrl("/relative")).toBe(false);
    expect(isTrackableUrl("https://user:pass@example.com")).toBe(false);
    expect(isTrackableUrl("https://exa mple.com")).toBe(false);
    expect(isTrackableUrl("data:text/html,hi")).toBe(false);
  });

  it("finds distinct links with their text, plus the button", () => {
    const html = '<p><a href="https://a.test/x?y=1&amp;z=2" rel="noopener">Read <b>this</b></a> <a href="mailto:a@b.co">mail</a> <a href="https://a.test/x?y=1&amp;z=2">again</a></p>';
    expect(extractLinks(html)).toEqual([{ url: "https://a.test/x?y=1&z=2", label: "Read this" }]);
    expect(postLinks(html, "https://shop.test/buy", "Buy now").map((link) => link.label)).toEqual(["Buy now", "Read this"]);
    expect(postLinks(html, "javascript:x", "Bad")).toHaveLength(1);
  });

  it("rewrites tracked links to the counting redirect and leaves the rest alone", () => {
    const html = '<p><a href="https://a.test/x?y=1&amp;z=2" target="_blank" rel="noopener noreferrer">A</a> <a href="mailto:a@b.co">M</a></p>';
    const out = rewriteLinks(html, (url) => (url === "https://a.test/x?y=1&z=2" ? trackedPath("/b/site", "11111111-1111-1111-1111-111111111111") : null));
    expect(out).toBe('<p><a href="/b/site/go/11111111-1111-1111-1111-111111111111" target="_blank" rel="noopener noreferrer">A</a> <a href="mailto:a@b.co">M</a></p>');
  });

  it("redirects only to the stored URL of a link on this site, on a live post (no open redirect)", () => {
    const link = { id: "l1", siteId: "s1", postId: "p1", url: "https://a.test/x" };
    expect(redirectTarget(link, { id: "s1" }, true)).toBe("https://a.test/x");
    expect(redirectTarget(link, { id: "s2" }, true)).toBeNull();
    expect(redirectTarget(link, { id: "s1" }, false)).toBeNull();
    expect(redirectTarget(null, { id: "s1" }, true)).toBeNull();
    expect(redirectTarget({ ...link, url: "javascript:alert(1)" }, { id: "s1" }, true)).toBeNull();
    expect(redirectTarget({ ...link, url: "//evil.example/" }, { id: "s1" }, true)).toBeNull();
  });

  it("counts clicks per link, leaving bots out by default", () => {
    const rows = [
      { linkId: "a", botReason: null },
      { linkId: "a", botReason: "datacenter" },
      { linkId: "b", botReason: null },
    ];
    expect(Object.fromEntries(clickCounts(rows))).toEqual({ a: 1, b: 1 });
    expect(Object.fromEntries(clickCounts(rows, true))).toEqual({ a: 2, b: 1 });
  });
});

describe("calendar status", () => {
  const now = new Date("2026-11-17T12:00:00Z");
  it("is Scheduled until the post goes live, then Sent", () => {
    expect(calendarStatusFor(new Date("2026-11-18T00:00:00Z"), now)).toBe("Scheduled");
    expect(calendarStatusFor(new Date("2026-11-17T11:59:00Z"), now)).toBe("Sent");
  });
  it("flips only Scheduled issues of published, live, undeleted posts", () => {
    const live = { status: "published", publishAt: new Date("2026-11-17T11:00:00Z"), deletedAt: null };
    expect(shouldFlipToSent("Scheduled", live, now)).toBe(true);
    expect(shouldFlipToSent("Planned", live, now)).toBe(false);
    expect(shouldFlipToSent("Scheduled", { ...live, publishAt: new Date("2026-11-18T00:00:00Z") }, now)).toBe(false);
    expect(shouldFlipToSent("Scheduled", { ...live, status: "draft" }, now)).toBe(false);
    expect(shouldFlipToSent("Scheduled", { ...live, deletedAt: now }, now)).toBe(false);
  });
});
