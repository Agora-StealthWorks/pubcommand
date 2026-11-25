import { describe, expect, it } from "vitest";
import { manifest } from "./manifest";
import { MINIBLOG_PREFIXES, miniBlogPath, publicBaseFor } from "./paths";
import { checkSite, contrastText, csvCell, excerpt, htmlToText, isValidSlug, normalizeSlug, postBrainNote, postState, toCsv } from "./site";
import { formatPhone, isE164, maskPhone, normalizePhone } from "./sms";
import { formatZonedDate, utcToZonedLocal, zonedLocalToUtc } from "./time";

describe("manifest", () => {
  it("is its own app at /mini-blog", () => {
    expect(manifest.id).toBe("miniblog");
    expect(manifest.planEntitlement).toBe("miniblog");
    expect(manifest.nav[0]?.href).toBe("/mini-blog");
    expect(manifest.permissions.map((permission) => permission.key)).toEqual(["miniblog.read", "miniblog.write", "miniblog.publish", "miniblog.manage"]);
  });
});

describe("phone numbers", () => {
  it("normalizes common US formats to E.164", () => {
    for (const input of ["(212) 555-0142", "212-555-0142", "212.555.0142", "2125550142", "1 212 555 0142", "+1 212 555 0142"]) {
      expect(normalizePhone(input)).toBe("+12125550142");
    }
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("0044 20 7946 0958")).toBe("+442079460958");
  });

  it("rejects what cannot be a mobile number", () => {
    for (const input of ["", "555-0142", "(012) 555-0142", "212 155 0142", "+0 123 456 789", "12345", "+1234567890123456", "call me", "212-555-0142 ext 4", "++12125550142"]) {
      expect(normalizePhone(input)).toBeNull();
    }
    expect(isE164("+12125550142")).toBe(true);
    expect(isE164("12125550142")).toBe(false);
    expect(formatPhone("+12125550142")).toBe("(212) 555-0142");
    expect(maskPhone("+12125550142")).toBe("•••0142");
  });
});

describe("site checks and exports", () => {
  it("blocks going live without a name or a valid link name", () => {
    const result = checkSite({ name: " ", slug: "Bad Slug", privacyUrl: null, termsUrl: null, programName: "", helpContact: "", medium: "Email" });
    expect(result.errors).toHaveLength(3);
    expect(checkSite({ name: "S", slug: "s", privacyUrl: "https://x.example/p", termsUrl: null, programName: "", helpContact: "", medium: "Email" })).toEqual({ errors: [], warnings: [] });
  });

  it("makes slugs and refuses bad ones", () => {
    expect(normalizeSlug("  Morning Alerts: Day ’1’! ")).toBe("morning-alerts-day-1");
    expect(isValidSlug("morning-alerts")).toBe(true);
    expect(isValidSlug("-bad")).toBe(false);
  });

  it("neutralizes spreadsheet formulas but keeps phone numbers", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
    expect(csvCell("+12125550142")).toBe(`"+12125550142"`);
    expect(toCsv(["a"], [["b"]])).toBe(`"a"\r\n"b"\r\n`);
  });

  it("knows draft, scheduled and published posts", () => {
    const now = new Date("2026-11-17T12:00:00Z");
    expect(postState({ status: "draft", publishAt: now }, now)).toBe("draft");
    expect(postState({ status: "published", publishAt: new Date("2026-11-18T00:00:00Z") }, now)).toBe("scheduled");
    expect(postState({ status: "published", publishAt: new Date("2026-11-16T00:00:00Z") }, now)).toBe("published");
  });

  it("picks readable text on a colour", () => {
    expect(contrastText("#111827")).toBe("#ffffff");
    expect(contrastText("#fef08a")).toBe("#0b1220");
  });

  it("reads post times in the org time zone", () => {
    const utc = zonedLocalToUtc("2026-11-03T20:00", "America/New_York");
    expect(utc?.toISOString()).toBe("2026-11-04T01:00:00.000Z");
    expect(utcToZonedLocal(utc, "America/New_York")).toBe("2026-11-03T20:00");
    expect(formatZonedDate(utc, "America/New_York")).toBe("Nov 3, 2026");
  });
});

describe("Brain note", () => {
  it("builds a post note from text, not HTML, and never carries phone numbers", () => {
    expect(htmlToText("<p>Hello <b>there</b></p><ul><li>One</li></ul>")).toBe("Hello there\n- One");
    expect(excerpt("<p>" + "word ".repeat(80) + "</p>", 30).endsWith("…")).toBe(true);
    const note = postBrainNote({ siteName: "Alerts", title: "Big news", publishLabel: "today", bodyHtml: "<p>Read this</p>", actionToTake: null, siteOptins: 12, postViews: 40 });
    expect(note.title).toBe("Mini-Blog post: Big news");
    expect(note.body).toContain("Mini-Blog subscribers (all time): 12.");
    expect(note.body).not.toContain("<p>");
  });
});

describe("public paths", () => {
  it("builds canonical /b/ links", () => {
    expect(miniBlogPath("alerts")).toBe("/b/alerts");
    expect(miniBlogPath("alerts", "big-news")).toBe("/b/alerts/big-news");
    expect(miniBlogPath("alerts", "/subscribe")).toBe("/b/alerts/subscribe");
    expect(MINIBLOG_PREFIXES).toEqual(["b", "t"]);
  });

  it("keeps links on the prefix the visitor used, and relative on a custom domain", () => {
    expect(publicBaseFor("/b/alerts", "alerts")).toBe("/b/alerts");
    expect(publicBaseFor("/b/alerts/big-news", "alerts")).toBe("/b/alerts");
    expect(publicBaseFor("/t/alerts", "alerts")).toBe("/t/alerts");
    expect(publicBaseFor("/t/alerts/subscribe", "alerts")).toBe("/t/alerts");
    expect(publicBaseFor("/", "alerts")).toBe("");
    expect(publicBaseFor("/subscribe", "alerts")).toBe("");
    expect(publicBaseFor("/b/alerts-two", "alerts")).toBe("");
    expect(publicBaseFor("/l/alerts", "alerts")).toBe("");
  });
});
