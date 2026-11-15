import { describe, expect, it } from "vitest";
import { RESERVED_SLUGS } from "./slug";
import {
  defaultOrganizationPlaces,
  firstAdminMembershipStatus,
  organizationAdminRoleGrants,
  organizationInviteNotice,
  organizationPublicUrl,
  validateOrganizationDraft,
} from "./organization";

const draft = {
  name: "Agora Daily",
  slug: "agora",
  planId: "11111111-1111-4111-8111-111111111111",
  adminEmail: "Ada@Example.com",
};

describe("validateOrganizationDraft", () => {
  it("normalizes the name, slug, and admin email", () => {
    expect(validateOrganizationDraft({ ...draft, slug: "Agora", adminEmail: "  Ada@Example.com " })).toEqual({
      ok: true,
      name: "Agora Daily",
      slug: "agora",
      planId: draft.planId,
      adminEmail: "ada@example.com",
    });
  });

  it("requires a name, a plan, and an email", () => {
    expect(validateOrganizationDraft({ ...draft, name: " " }).ok).toBe(false);
    expect(validateOrganizationDraft({ ...draft, planId: "" })).toMatchObject({ field: "plan" });
    expect(validateOrganizationDraft({ ...draft, adminEmail: "not-an-email" })).toMatchObject({ field: "email" });
  });

  it("blocks reserved subdomains, including admin, app, www, and api", () => {
    for (const slug of ["admin", "app", "www", "api", ...RESERVED_SLUGS]) {
      expect(validateOrganizationDraft({ ...draft, slug })).toEqual({
        ok: false,
        field: "slug",
        message: "That subdomain is reserved.",
      });
    }
    expect(validateOrganizationDraft({ ...draft, slug: "ADMIN" }).ok).toBe(false);
    expect(validateOrganizationDraft({ ...draft, slug: "ab" })).toMatchObject({ field: "slug" });
  });
});

describe("organization defaults", () => {
  it("creates a brand from the name and a default workspace", () => {
    expect(defaultOrganizationPlaces("Agora Daily")).toEqual({
      brand: { name: "Agora Daily", slug: "agora-daily" },
      workspace: { name: "Default", slug: "default" },
    });
    expect(defaultOrganizationPlaces("A").brand.slug).toBe("main");
  });

  it("gives owner and admin the same grants", () => {
    const roles = organizationAdminRoleGrants(["settings.manage", "settings.manage", "knowledge.read"]);
    expect(roles.map((role) => role.slug)).toEqual(["owner", "admin"]);
    expect(roles[0]?.permissions).toEqual(["settings.manage", "knowledge.read"]);
    expect(roles[1]?.permissions).toEqual(roles[0]?.permissions);
  });

  it("activates the creator and invites everyone else", () => {
    expect(firstAdminMembershipStatus("Stephen@onenationfinancial.com", "stephen@onenationfinancial.com")).toBe("ACTIVE");
    expect(firstAdminMembershipStatus("ada@example.com", "stephen@onenationfinancial.com")).toBe("INVITED");
  });

  it("builds the public host from ROOT_DOMAIN", () => {
    expect(organizationPublicUrl("agora", "pubcommand.com")).toBe("https://agora.pubcommand.com");
    expect(organizationPublicUrl("agora", "PUBCOMMAND.COM")).toBe("https://agora.pubcommand.com");
    expect(organizationPublicUrl("agora", "localhost")).toBe("http://agora.localhost");
  });
});

describe("organizationInviteNotice", () => {
  const magicUrl = "https://agora.pubcommand.com/api/auth/magic-link/verify?token=secret-token";

  it("never puts the magic link on the page unless the dev flag is on", () => {
    for (const delivered of ["sent", "logged", "failed"] as const) {
      const notice = organizationInviteNotice({
        lead: "Organization created.",
        delivered,
        magicUrl,
        exposeOnPage: false,
      });
      expect(notice).not.toContain("secret-token");
      expect(notice).not.toContain("http");
    }
    expect(
      organizationInviteNotice({ lead: "Organization created.", delivered: "logged", magicUrl, exposeOnPage: false }),
    ).toBe("Organization created.");
    expect(
      organizationInviteNotice({ lead: "Organization created.", delivered: "sent", magicUrl, exposeOnPage: true }),
    ).toContain("secret-token");
  });
});
