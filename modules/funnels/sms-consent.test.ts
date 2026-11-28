import { describe, expect, it } from "vitest";
import type { ConsentSite } from "../miniblog/sms";
import { captureOptin, standardConsent } from "./sms";

describe("SMS consent capture", () => {
  const site: ConsentSite = {
    programName: "Morning Alerts",
    companyName: "Example Gazette",
    messageFrequency: "Up to 5 msgs/week",
    helpContact: "help@example.com",
    privacyUrl: "https://example.com/privacy",
    termsUrl: "https://example.com/sms-terms",
  };
  const text = standardConsent(site);

  it("writes the consent text with the required disclosures", () => {
    expect(text).toContain("Example Gazette (Morning Alerts)");
    expect(text).toContain("Up to 5 msgs/week.");
    expect(text).toContain("Msg & data rates may apply.");
    expect(text).toContain("Reply STOP to cancel or HELP for help (or contact help@example.com).");
    expect(text).toContain("Consent is not a condition of any purchase.");
    expect(text).toContain("Privacy Policy: https://example.com/privacy");
  });

  it("stores the normalized phone and the exact text shown", () => {
    expect(captureOptin({ phone: "(212) 555-0142", consentChecked: true, shownConsent: text, honeypot: "" }, text)).toEqual({ ok: true, record: { phone: "+12125550142", consentText: text } });
  });

  it("refuses without consent, with a bad number, with stale text, and quietly drops bots", () => {
    expect(captureOptin({ phone: "2125550142", consentChecked: false, shownConsent: text, honeypot: "" }, text)).toMatchObject({ ok: false, error: expect.stringContaining("Check the box") });
    expect(captureOptin({ phone: "555", consentChecked: true, shownConsent: text, honeypot: "" }, text)).toMatchObject({ ok: false, error: expect.stringContaining("valid mobile") });
    expect(captureOptin({ phone: "2125550142", consentChecked: true, shownConsent: "older wording", honeypot: "" }, text)).toMatchObject({ ok: false, error: expect.stringContaining("updated") });
    expect(captureOptin({ phone: "2125550142", consentChecked: true, shownConsent: text, honeypot: "http://spam" }, text)).toMatchObject({ ok: false, spam: true });
  });
});
