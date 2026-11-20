import { describe, expect, it } from "vitest";
import {
  anonymizedEmail,
  emailConfirmationMatches,
  hostnameConfirmationMatches,
  organizationConfirmationMatches,
  organizationPurgeDate,
  organizationPurgeDue,
  userDeleteBlocked,
} from "./lifecycle";

const base = { actorUserId: "staff", target: { id: "u1", email: "Person@Example.com", deleted: false }, superAdminEmails: ["stephen@onenationfinancial.com"], lastAdminOf: [] };

describe("user delete guards", () => {
  it("allows an ordinary account", () => expect(userDeleteBlocked(base)).toBeNull());
  it("blocks deleting yourself", () => expect(userDeleteBlocked({ ...base, actorUserId: "u1" })).toMatch(/your own/));
  it("blocks the configured super admin (case-insensitive)", () =>
    expect(userDeleteBlocked({ ...base, target: { ...base.target, email: "Stephen@OneNationFinancial.com" } })).toMatch(/super admin/));
  it("blocks the last admin of an org and names it", () =>
    expect(userDeleteBlocked({ ...base, lastAdminOf: [{ name: "Gazette", slug: "gazette" }] })).toMatch(/last admin of Gazette \(gazette\)/));
  it("blocks an account that is already deleted", () => expect(userDeleteBlocked({ ...base, target: { ...base.target, deleted: true } })).toMatch(/already/));
});

describe("typed confirmations", () => {
  it("organization: exact slug (any case) or exact name", () => {
    const org = { slug: "acme", name: "Acme Media" };
    expect(organizationConfirmationMatches("acme", org)).toBe(true);
    expect(organizationConfirmationMatches(" ACME ", org)).toBe(true);
    expect(organizationConfirmationMatches("Acme Media", org)).toBe(true);
    expect(organizationConfirmationMatches("acme media", org)).toBe(false);
    expect(organizationConfirmationMatches("", org)).toBe(false);
  });
  it("email and hostname", () => {
    expect(emailConfirmationMatches("person@example.com", "Person@Example.com")).toBe(true);
    expect(emailConfirmationMatches("person@example.co", "Person@Example.com")).toBe(false);
    expect(hostnameConfirmationMatches("Hub.Example.com.", "hub.example.com")).toBe(true);
    expect(hostnameConfirmationMatches("example.com", "hub.example.com")).toBe(false);
  });
});

describe("purge schedule", () => {
  it("purges 30 days after deletion", () => {
    const deleted = new Date("2026-11-01T00:00:00Z");
    expect(organizationPurgeDate(deleted).toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(organizationPurgeDue(deleted, new Date("2026-11-30T23:59:00Z"))).toBe(false);
    expect(organizationPurgeDue(deleted, new Date("2026-12-01T00:00:00Z"))).toBe(true);
    expect(organizationPurgeDue(null)).toBe(false);
  });
  it("anonymized email is unique per account and undeliverable", () => {
    expect(anonymizedEmail("abc")).toBe("deleted-abc@deleted.invalid");
  });
});
