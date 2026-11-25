import { describe, expect, it } from "vitest";
import { inviteEmail, passwordResetEmail, renderEmailLayout } from "./email-layout";

describe("email layout", () => {
  it("escapes every value and keeps the link in both versions", () => {
    const email = renderEmailLayout({
      senderName: "Free <Market>",
      logoUrl: "https://example.com/logo.png?a=1&b=2",
      heading: "Hi & welcome",
      paragraphs: ["Line <one>"],
      button: { label: "Go", url: "https://example.com/x?token=abc&next=%2Fmy", color: "#123456" },
      footnote: "Ignore \"this\"",
    });
    expect(email.html).toContain("Free &lt;Market&gt;");
    expect(email.html).toContain("Hi &amp; welcome");
    expect(email.html).toContain("Line &lt;one&gt;");
    expect(email.html).toContain("token=abc&amp;next=%2Fmy");
    expect(email.html).toContain("logo.png?a=1&amp;b=2");
    expect(email.html).toContain("background:#123456");
    expect(email.text).toContain("Go: https://example.com/x?token=abc&next=%2Fmy");
    expect(email.text).toContain("Line <one>");
    expect(email.text).not.toContain("<p");
  });

  it("uses the sender name when there is no logo, and refuses unsafe URLs and colors", () => {
    const email = renderEmailLayout({
      senderName: "Site",
      logoUrl: "javascript:alert(1)",
      heading: "H",
      paragraphs: [],
      button: { label: "Go", url: "javascript:alert(1)", color: "red;x:y" },
    });
    expect(email.html).not.toContain("<img");
    expect(email.html).not.toContain("javascript:");
    expect(email.html).toContain(">Site</span>");
    expect(email.html).toContain("background:#7C3AED");
  });

  it("builds the PubCommand reset email with the logo and the exact subject", () => {
    const email = passwordResetEmail({ link: "https://app.pubcommand.com/reset-password?token=t", logoUrl: "https://app.pubcommand.com/brand/logo-light.png", minutes: 30 });
    expect(email.subject).toBe("Reset your PubCommand password");
    expect(email.html).toContain('src="https://app.pubcommand.com/brand/logo-light.png"');
    expect(email.html).toContain("30 minutes");
    expect(email.text).toContain("https://app.pubcommand.com/reset-password?token=t");
    expect(email.text).not.toMatch(/sign-in link/i);
  });

  it("puts the black Agora StealthWorks bar under the PubCommand masthead, and names the owner in the footer", () => {
    const email = passwordResetEmail({ link: "https://app.pubcommand.com/reset-password?token=t", origin: "https://app.pubcommand.com", minutes: 30 });
    const bar = email.html.indexOf("agora-stealthworks-white.png");
    const masthead = email.html.indexOf("logo-light.png");
    expect(bar).toBeGreaterThan(-1);
    expect(masthead).toBeGreaterThan(-1);
    expect(bar).toBeGreaterThan(masthead);
    expect(email.html).toContain("background:#000000");
    expect(email.html).toContain('alt="By Agora StealthWorks"');
    expect(email.html).toContain("PubCommand by Agora StealthWorks");
    expect(email.text).toContain("PubCommand by Agora StealthWorks");
  });

  it("uses staff edits, fills placeholders, and keeps the real link", () => {
    const email = inviteEmail({
      link: "https://acme.pubcommand.com/api/auth/magic-link/verify?token=abc",
      origin: "https://acme.pubcommand.com",
      organizationName: "Acme <News>",
      overrides: { invite_organization: { subject: "Welcome to {organization}", body: "First.\n\nSecond\nline.", buttonLabel: "Let me in" } },
    });
    expect(email.subject).toBe("Welcome to Acme <News>");
    expect(email.html).toContain("Acme &lt;News&gt;");
    expect(email.html).toContain(">First.</p>");
    expect(email.html).toContain(">Second line.</p>");
    expect(email.html).toContain("Let me in");
    // Fields left alone keep the default.
    expect(email.html).toContain("Join Acme &lt;News&gt; on PubCommand");
    expect(email.text).toContain("Let me in: https://acme.pubcommand.com/api/auth/magic-link/verify?token=abc");
  });

  it("uses the staff invite when there is no organization", () => {
    expect(inviteEmail({ link: "https://admin.pubcommand.com/x", origin: null }).subject).toBe("You're invited to PubCommand");
  });
});
