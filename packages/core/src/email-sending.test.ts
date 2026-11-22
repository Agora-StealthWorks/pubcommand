import { describe, expect, it } from "vitest";
import { chooseEmailRoute, formatFrom, resolveSender } from "./email-sending";

describe("sender resolution", () => {
  const organization = { fromName: "Acme Media", fromAddress: "hello@acme.com", replyTo: "help@acme.com" };
  const brand = { fromName: "Liberty Letters", fromAddress: "news@liberty.com", replyTo: null };
  const publication = { fromName: "The Edge", fromAddress: null, replyTo: "edge@liberty.com" };

  it("takes each field from the publication, then the brand, then the organization", () => {
    expect(resolveSender({ publication, brand, organization })).toEqual({ fromName: "The Edge", fromAddress: "news@liberty.com", replyTo: "edge@liberty.com" });
    expect(resolveSender({ brand, organization })).toEqual({ fromName: "Liberty Letters", fromAddress: "news@liberty.com", replyTo: "help@acme.com" });
    expect(resolveSender({ organization })).toEqual(organization);
    expect(resolveSender({})).toEqual({ fromName: null, fromAddress: null, replyTo: null });
  });

  it("skips blank and invalid addresses", () => {
    expect(resolveSender({ publication: { fromAddress: "  ", replyTo: "not an email" }, organization }).fromAddress).toBe("hello@acme.com");
    expect(resolveSender({ publication: { replyTo: "not an email" }, organization }).replyTo).toBe("help@acme.com");
  });
});

describe("email route", () => {
  const sender = { fromName: "Liberty Letters", fromAddress: "news@liberty.com", replyTo: null };

  it("uses the organization's own key and address when connected", () => {
    expect(chooseEmailRoute({ orgApiKey: "re_org", platformApiKey: "re_pc", platformFrom: "login@pubcommand.com", sender, displayName: "Site" })).toEqual({
      kind: "org",
      apiKey: "re_org",
      from: '"Liberty Letters" <news@liberty.com>',
      replyTo: null,
    });
  });

  it("falls back to PubCommand's key, PubCommand's address and the brand's name, replying to the brand", () => {
    expect(chooseEmailRoute({ orgApiKey: null, platformApiKey: "re_pc", platformFrom: "PubCommand <login@pubcommand.com>", sender, displayName: "Site" })).toEqual({
      kind: "platform",
      apiKey: "re_pc",
      from: '"Liberty Letters" <login@pubcommand.com>',
      replyTo: "news@liberty.com",
    });
  });

  it("uses the site name when no sender name is set, and reports when no key exists", () => {
    const route = chooseEmailRoute({ orgApiKey: "", platformApiKey: null, platformFrom: "login@pubcommand.com", sender: { fromName: null, fromAddress: null, replyTo: null }, displayName: "Liberty Site" });
    expect(route).toEqual({ kind: "none", from: '"Liberty Site" <login@pubcommand.com>', replyTo: null });
  });

  it("strips header-breaking characters from the display name", () => {
    expect(formatFrom('Bad "Name" <x>\r\n', "a@b.co")).toBe('"Bad Name x" <a@b.co>');
  });
});
