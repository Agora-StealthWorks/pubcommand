import { describe, expect, it } from "vitest";
import { PASSWORD_FORM_ERRORS, RESERVED_SLUGS, canRead, membersGate, senderWithName, setPasswordEmail, viewerFor, type Access } from "./content";

const paid: Access = { all: true, paid: true, publicationIds: new Set() };

describe("member login gating", () => {
  it("sends a reader with no session to log in", () => {
    expect(membersGate(null)).toBe("sign-in");
    expect(viewerFor(null)).toEqual({ signedIn: false });
  });

  it("sends a member without a password to set one, and treats them as signed out for reading", () => {
    const pending = { hasPassword: false, access: paid };
    expect(membersGate(pending)).toBe("set-password");
    expect(viewerFor(pending)).toEqual({ signedIn: false });
    // Even a paying member cannot read members-only posts on a set-password link alone.
    expect(canRead({ access: "members", publicationId: null }, viewerFor(pending))).toEqual({ allowed: false, reason: "upgrade" });
    expect(canRead({ access: "public", publicationId: null }, viewerFor(pending))).toEqual({ allowed: true });
  });

  it("lets a member with a password in", () => {
    const member = { hasPassword: true, access: paid };
    expect(membersGate(member)).toBe("ok");
    expect(canRead({ access: "members", publicationId: "p1" }, viewerFor(member))).toEqual({ allowed: true });
  });

  it("has a fixed message for every password form error code", () => {
    for (const code of ["match", "short", "long", "spaces", "current", "stale"]) expect(PASSWORD_FORM_ERRORS[code]).toBeTruthy();
  });

  it("reserves /publications for the publications list", () => {
    expect(RESERVED_SLUGS).toContain("publications");
  });
});

describe("member emails", () => {
  it("send from the site's name at the configured address", () => {
    expect(senderWithName("Free Market Society", "login@example.com")).toBe('"Free Market Society" <login@example.com>');
    expect(senderWithName("Free Market Society", "Platform Name <login@example.com>")).toBe('"Free Market Society" <login@example.com>');
    expect(senderWithName('Bad "Name" <x>\r\n', "a@b.co")).toBe('"Bad Name x" <a@b.co>');
    expect(senderWithName("", "a@b.co")).toBe("a@b.co");
  });

  it("are about setting a password, name only the site, and escape it", () => {
    const email = setPasswordEmail({ siteName: "Free Market <Society>", memberName: "Ann", link: "https://fms.example/sign-in/verify?token=abc&next=%2Fmy" });
    expect(email.subject).toBe("Set your password for Free Market <Society>");
    expect(email.html).toContain("Free Market &lt;Society&gt;");
    expect(email.html).toContain("token=abc&amp;next=%2Fmy");
    expect(email.text).toContain("https://fms.example/sign-in/verify?token=abc&next=%2Fmy");
    for (const part of [email.subject, email.html, email.text]) {
      expect(part).not.toMatch(/pubcommand/i);
      expect(part).not.toMatch(/sign-in link|magic/i);
    }
  });
});
