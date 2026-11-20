import { describe, expect, it } from "vitest";
import {
  canRead,
  csv,
  effectiveStatus,
  entitlementActive,
  excerptFrom,
  memberAccess,
  menuHref,
  normalizeEmail,
  parseMenu,
  publicBaseFor,
  safePostSlug,
  safeReturnPath,
  statusForSave,
  teaserHtml,
  themeFrom,
} from "./content";

const now = new Date("2026-11-19T12:00:00Z");
const day = 86_400_000;

describe("posts", () => {
  it("treats a scheduled post whose time has passed as published", () => {
    expect(effectiveStatus({ status: "scheduled", publishedAt: new Date(now.getTime() - 1000) }, now)).toBe("published");
    expect(effectiveStatus({ status: "published", publishedAt: new Date(now.getTime() + day) }, now)).toBe("scheduled");
    expect(effectiveStatus({ status: "weird", publishedAt: null }, now)).toBe("draft");
  });

  it("turns publish into pending review for writers without publish rights", () => {
    expect(statusForSave({ wanted: "publish", publishAt: null, canPublish: false, now }).status).toBe("pending");
    expect(statusForSave({ wanted: "publish", publishAt: null, canPublish: true, now })).toEqual({ status: "published", publishedAt: now });
    const later = new Date(now.getTime() + day);
    expect(statusForSave({ wanted: "publish", publishAt: later, canPublish: true, now })).toEqual({ status: "scheduled", publishedAt: later });
    expect(statusForSave({ wanted: "draft", publishAt: null, canPublish: true, now }).status).toBe("draft");
  });

  it("keeps post slugs off the site's own routes and public prefixes", () => {
    expect(safePostSlug("My Account")).toBe("my-account");
    expect(safePostSlug("my")).toBe("my-1");
    expect(safePostSlug("Research")).toBe("research-1");
    expect(safePostSlug("w")).toBe("w-1");
    expect(safePostSlug("Café Société!")).toBe("cafe-societe");
    expect(safePostSlug("")).toBe("post");
  });

  it("builds teasers from whole blocks only", () => {
    const html = "<p>One</p><h2>Two</h2><p>Three <b>bold</b></p><ul><li>x</li></ul>";
    expect(teaserHtml(html, 2)).toBe("<p>One</p><h2>Two</h2>");
    expect(teaserHtml(html, 0)).toBe("");
    expect(teaserHtml(html, 99)).toBe(html);
  });

  it("makes plain excerpts", () => {
    expect(excerptFrom("<p>Hello &amp; <b>welcome</b></p><script>x()</script>")).toBe("Hello & welcome");
    expect(excerptFrom(`<p>${"word ".repeat(100)}</p>`, 30).endsWith("…")).toBe(true);
  });
});

describe("access", () => {
  const products = [
    { id: "fmi", publicationIds: ["pub-fmi"], allPublications: false, active: true },
    { id: "alliance", publicationIds: [], allPublications: true, active: true },
  ];
  const grant = (productId: string, extra: Partial<{ status: string; startsAt: Date; endsAt: Date | null }> = {}) => ({ productId, status: "active", startsAt: new Date(now.getTime() - day), endsAt: null, ...extra });

  it("only counts entitlements that are on today (past due keeps access until its end date)", () => {
    expect(entitlementActive(grant("fmi"), now)).toBe(true);
    expect(entitlementActive(grant("fmi", { status: "cancelled" }), now)).toBe(false);
    expect(entitlementActive(grant("fmi", { endsAt: new Date(now.getTime() - 1) }), now)).toBe(false);
    expect(entitlementActive(grant("fmi", { startsAt: new Date(now.getTime() + day) }), now)).toBe(false);
    expect(entitlementActive(grant("fmi", { status: "past_due", endsAt: new Date(now.getTime() + day) }), now)).toBe(true);
  });

  it("opens posts by access level and publication", () => {
    const anon = { signedIn: false } as const;
    const free = { signedIn: true, access: memberAccess([], products, now) } as const;
    const fmi = { signedIn: true, access: memberAccess([grant("fmi")], products, now) } as const;
    const all = { signedIn: true, access: memberAccess([grant("alliance")], products, now) } as const;
    const fmiPost = { access: "members", publicationId: "pub-fmi" };
    const otherPost = { access: "members", publicationId: "pub-other" };
    const anyPaid = { access: "members", publicationId: null };

    expect(canRead({ access: "public", publicationId: null }, anon)).toEqual({ allowed: true });
    expect(canRead({ access: "free", publicationId: null }, anon)).toEqual({ allowed: false, reason: "sign-in" });
    expect(canRead({ access: "free", publicationId: null }, free)).toEqual({ allowed: true });
    expect(canRead(fmiPost, anon)).toEqual({ allowed: false, reason: "upgrade" });
    expect(canRead(fmiPost, free)).toEqual({ allowed: false, reason: "upgrade" });
    expect(canRead(fmiPost, fmi)).toEqual({ allowed: true });
    expect(canRead(otherPost, fmi)).toEqual({ allowed: false, reason: "upgrade" });
    expect(canRead(otherPost, all)).toEqual({ allowed: true });
    expect(canRead(anyPaid, fmi)).toEqual({ allowed: true });
    expect(canRead(anyPaid, free)).toEqual({ allowed: false, reason: "upgrade" });
  });

  it("drops access when the entitlement ends", () => {
    const ended = memberAccess([grant("fmi", { endsAt: new Date(now.getTime() - 1) })], products, now);
    expect(canRead({ access: "members", publicationId: "pub-fmi" }, { signedIn: true, access: ended }).allowed).toBe(false);
  });
});

describe("paths, menus and input", () => {
  it("uses /w/<site> on the org host and clean paths on the site's own domain", () => {
    expect(publicBaseFor("/w/fms/my", "fms")).toBe("/w/fms");
    expect(publicBaseFor("/w/fms", "fms")).toBe("/w/fms");
    expect(publicBaseFor("/my", "fms")).toBe("");
    expect(publicBaseFor("/w/fmsx/a", "fms")).toBe("");
    expect(menuHref("/w/fms", "/")).toBe("/w/fms");
    expect(menuHref("", "/")).toBe("/");
    expect(menuHref("/w/fms", "/research")).toBe("/w/fms/research");
    expect(menuHref("/w/fms", "https://x.com/a")).toBe("https://x.com/a");
  });

  it("parses menus and drops unsafe links", () => {
    expect(parseMenu("Latest | /\nBad | javascript:alert(1)\nProto | //evil.com\nX | https://x.com\nno pipe")).toEqual([
      { label: "Latest", href: "/" },
      { label: "X", href: "https://x.com" },
    ]);
  });

  it("only returns to same-site paths", () => {
    expect(safeReturnPath("/w/fms/post", "/")).toBe("/w/fms/post");
    expect(safeReturnPath("//evil.com", "/")).toBe("/");
    expect(safeReturnPath("https://evil.com", "/")).toBe("/");
    expect(safeReturnPath("/a/../b", "/")).toBe("/");
    expect(safeReturnPath("/w/fms/newsletters/x#signup", "/")).toBe("/w/fms/newsletters/x#signup");
    expect(safeReturnPath("/x#a b", "/")).toBe("/");
  });

  it("normalizes emails and theme colors", () => {
    expect(normalizeEmail("  Reader@Example.COM ")).toBe("reader@example.com");
    expect(normalizeEmail("nope")).toBeNull();
    expect(themeFrom({ primary: "#ABCDEF", accent: "red" }).primary).toBe("#abcdef");
    expect(themeFrom({ accent: "red" }).accent).toBe("#c49a4e");
  });

  it("writes CSV that spreadsheets will not execute", () => {
    expect(csv([["a", "=1+1"], ['x,"y"', null]])).toBe(`a,'=1+1\r\n"x,""y""",`);
  });
});
