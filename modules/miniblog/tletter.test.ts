import { describe, expect, it } from "vitest";
import { acceptAdChoice, adChoiceOptions, hasContentAd, newAdCodeId, parseAdChoice, parseAdCodes, resolveAd, splitAtContentAd, stripContentAd } from "./ads";
import { postLinks } from "./links";
import { acceptMedium, cleanMediums, mediumOptions, mediumsFromText, subscribeKind } from "./mediums";
import { acceptCategory, categoriesFromText, parseTickers } from "./post-fields";
import { calendarStatusFor, checkSite } from "./site";
import { captureEmailOptin, emailConsentText, maskEmail, normalizeEmail } from "./sms";
import { byKind, formatPct, postStats, statsLine } from "./stats";
import { THEMES, isThemeId, themeById } from "./themes";

const CODES = parseAdCodes([
  { id: "adsense-top", name: "AdSense top", network: "adsense", code: "<ins class='adsbygoogle'></ins>" },
  { id: "taboola", name: "Taboola feed", network: "taboola", code: "<div id='taboola'></div>" },
]);

describe("ad zones", () => {
  it("parses stored ad codes and drops bad rows", () => {
    const codes = parseAdCodes([...CODES, { id: "adsense-top", name: "dup", code: "x" }, { id: "BAD ID", name: "x", code: "x" }, { id: "empty", name: "Empty", code: "  " }, { id: "kv", name: "Kevel", network: "nope", code: "<div></div>" }, "junk"]);
    expect(codes.map((code) => code.id)).toEqual(["adsense-top", "taboola", "kv"]);
    expect(codes[2]!.network).toBe("custom");
    expect(parseAdCodes(null)).toEqual([]);
  });

  it("accepts only choices that exist", () => {
    expect(acceptAdChoice("text", CODES)).toBe("text");
    expect(acceptAdChoice("code:taboola", CODES)).toBe("code:taboola");
    expect(acceptAdChoice("code:gone", CODES)).toBe("none");
    expect(acceptAdChoice("<script>", CODES)).toBe("none");
    expect(parseAdChoice("code:taboola")).toEqual({ kind: "code", id: "taboola" });
    expect(adChoiceOptions(CODES).map((option) => option.value)).toEqual(["none", "text", "code:adsense-top", "code:taboola"]);
  });

  it("resolves what a zone renders", () => {
    expect(resolveAd("text", " Buy now ", "https://x.test", CODES)).toEqual({ kind: "text", text: "Buy now", link: "https://x.test" });
    expect(resolveAd("text", "", "https://x.test", CODES)).toBeNull();
    expect(resolveAd("code:taboola", null, null, CODES)).toMatchObject({ kind: "code", code: { id: "taboola" } });
    expect(resolveAd("code:gone", null, null, CODES)).toBeNull();
    expect(resolveAd("none", "text", null, CODES)).toBeNull();
  });

  it("splits the body at the first [content ad] and drops the rest", () => {
    const html = "<p>One</p><p>[content ad]</p><p>Two</p><p>[Content Ad]</p><p>Three</p>";
    expect(hasContentAd(html)).toBe(true);
    expect(splitAtContentAd(html)).toEqual({ before: "<p>One</p>", after: "<p>Two</p><p>Three</p>" });
    expect(splitAtContentAd("<p>Before [content ad] after</p>")).toEqual({ before: "<p>Before ", after: " after</p>" });
    expect(splitAtContentAd("<p>None</p>")).toEqual({ before: "<p>None</p>", after: null });
    expect(stripContentAd(html)).toBe("<p>One</p><p>Two</p><p>Three</p>");
  });

  it("mints unique ad-code ids", () => {
    expect(newAdCodeId("AdSense top", CODES)).toBe("adsense-top-2");
    expect(newAdCodeId("!!!", [])).toBe("ad");
  });

  it("tracks text-ad links as ads and the button as the CTA", () => {
    const links = postLinks('<p><a href="https://a.test">A</a> <a href="https://ad.test">dup</a></p>', "https://buy.test", "Buy", [{ url: "https://ad.test", label: "Top ad" }]);
    expect(links.map((link) => [link.url, link.kind])).toEqual([
      ["https://ad.test", "ad"],
      ["https://buy.test", "cta"],
      ["https://a.test", "content"],
    ]);
  });
});

describe("mediums", () => {
  it("defaults to Email, SMS, Push Notification and cleans lists", () => {
    expect(cleanMediums([])).toEqual(["Email", "SMS", "Push Notification"]);
    expect(mediumsFromText(" SMS \nsms\n\nWhatsApp, Email ")).toEqual(["SMS", "WhatsApp", "Email"]);
  });

  it("picks the sign-up form from the medium", () => {
    expect(subscribeKind("SMS")).toBe("sms");
    expect(subscribeKind("Text alerts")).toBe("sms");
    expect(subscribeKind("Email")).toBe("email");
    expect(subscribeKind("Push Notification")).toBe("none");
  });

  it("only accepts listed mediums (or the current one)", () => {
    const list = ["Email", "SMS"];
    expect(acceptMedium("sms", list, null)).toBe("SMS");
    expect(acceptMedium("Fax", list, "Email")).toBe("Email");
    expect(acceptMedium("Legacy", list, "Legacy")).toBe("Legacy");
    expect(mediumOptions(list, "Legacy")).toEqual(["Email", "SMS", "Legacy"]);
  });
});

describe("go-live checks per medium", () => {
  const base = { name: "Alerts", slug: "alerts", privacyUrl: null, termsUrl: null, programName: "", helpContact: "" };
  it("keeps the carrier rules for SMS", () => {
    expect(checkSite({ ...base, medium: "SMS" }).errors).toHaveLength(3);
  });
  it("asks email Mini-Blogs for a privacy link only", () => {
    expect(checkSite({ ...base, medium: "Email" }).errors).toEqual(["Add a privacy-policy link. It is shown on the email sign-up form."]);
  });
  it("lets push Mini-Blogs go live without a form", () => {
    const result = checkSite({ ...base, medium: "Push Notification" });
    expect(result.errors).toEqual([]);
    expect(result.warnings[0]).toContain("no subscribe form");
  });
});

describe("email opt-ins", () => {
  const site = { programName: "Morning Note", companyName: "Acme", messageFrequency: "Daily", helpContact: "", privacyUrl: "https://acme.test/privacy", termsUrl: null };
  it("normalizes and masks addresses", () => {
    expect(normalizeEmail(" Jane@Example.COM ")).toBe("jane@example.com");
    expect(normalizeEmail("not an email")).toBeNull();
    expect(normalizeEmail("a@b")).toBeNull();
    expect(maskEmail("jane@example.com")).toBe("j•••@example.com");
  });
  it("stores the exact consent text and refuses stale forms", () => {
    const consent = emailConsentText(site);
    expect(consent).toContain("Morning Note");
    expect(captureEmailOptin({ email: "jane@example.com", consentChecked: true, shownConsent: consent, honeypot: "" }, consent)).toEqual({ ok: true, record: { email: "jane@example.com", consentText: consent } });
    expect(captureEmailOptin({ email: "jane@example.com", consentChecked: true, shownConsent: "old", honeypot: "" }, consent).ok).toBe(false);
    expect(captureEmailOptin({ email: "jane@example.com", consentChecked: false, shownConsent: consent, honeypot: "" }, consent).ok).toBe(false);
  });
});

describe("internal post fields", () => {
  it("cleans categories and resolves a post's category", () => {
    const list = categoriesFromText("Ticker Tuesday\n ticker tuesday \nMarket Recap\n");
    expect(list).toEqual(["Ticker Tuesday", "Market Recap"]);
    expect(acceptCategory("market recap", list)).toBe("Market Recap");
    expect(acceptCategory("Other", list)).toBeNull();
  });
  it("parses tickers", () => {
    expect(parseTickers("nvda, $AMD / brk.b nvda 123")).toEqual(["NVDA", "AMD", "BRK.B"]);
  });
});

describe("stat engine", () => {
  it("builds per-post stats with typed links and CTR", () => {
    const stats = postStats(
      ["p1", "p2"],
      [{ postId: "p1", views: 10, unique: 4 }],
      [{ postId: "p1", clicks: 3, unique: 2, flagged: 5 }],
      [
        { linkId: "l1", clicks: 2, unique: 1 },
        { linkId: "l2", clicks: 1, unique: 1 },
      ],
      [
        { id: "l1", postId: "p1", url: "https://a.test", label: "A", kind: "content" },
        { id: "l2", postId: "p1", url: "https://buy.test", label: "Buy", kind: "cta" },
        { id: "l3", postId: "p1", url: "https://ad.test", label: "Ad", kind: "ad" },
      ],
    );
    const p1 = stats.get("p1")!;
    expect(p1).toMatchObject({ views: 10, uniqueViews: 4, clicks: 3, uniqueClickers: 2, ctr: 0.5, flagged: 5 });
    expect(p1.links.map((link) => [link.id, link.kind, link.ctr])).toEqual([
      ["l1", "content", 0.25],
      ["l2", "cta", 0.25],
      ["l3", "ad", 0],
    ]);
    expect(byKind(p1.links)).toEqual({ ad: { clicks: 0, unique: 0 }, cta: { clicks: 1, unique: 1 }, content: { clicks: 2, unique: 1 } });
    expect(stats.get("p2")).toMatchObject({ views: 0, ctr: null, links: [] });
    expect(statsLine(p1)).toBe("10 views · 50.0% CTR");
    expect(formatPct(null)).toBe("—");
  });
});

describe("themes and calendar status", () => {
  it("has the T-Letter look and falls back to Classic", () => {
    expect(themeById("t-letter")).toMatchObject({ headerBg: "#0f2440", actionInk: "#2e9b3f", footer: "tletter" });
    expect(themeById("nope").id).toBe("classic");
    expect(isThemeId("midnight")).toBe(true);
    expect(new Set(THEMES.map((theme) => theme.id)).size).toBe(THEMES.length);
  });
  it("puts drafts on the Calendar as Drafting", () => {
    const now = new Date("2026-11-25T12:00:00Z");
    expect(calendarStatusFor(new Date("2026-11-26T00:00:00Z"), now, "draft")).toBe("Drafting");
    expect(calendarStatusFor(new Date("2026-11-26T00:00:00Z"), now, "pending")).toBe("Drafting");
    expect(calendarStatusFor(new Date("2026-11-26T00:00:00Z"), now, "published")).toBe("Scheduled");
    expect(calendarStatusFor(new Date("2026-11-24T00:00:00Z"), now)).toBe("Sent");
  });
});
