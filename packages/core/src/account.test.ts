import { describe, expect, it } from "vitest";
import {
  MEMBER_PASSWORD_MESSAGES,
  cleanDisplayName,
  createAttemptLimiter,
  memberPasswordBlocked,
  newPasswordProblem,
  passwordProblem,
  type MemberPasswordFacts,
} from "./account";

const ok: MemberPasswordFacts = {
  actorUserId: "admin",
  targetUserId: "member",
  actorCanManageUsers: true,
  impersonating: false,
  targetIsMember: true,
  targetIsStaff: false,
  targetOtherOrganizations: 0,
  targetDisabled: false,
};

describe("password rules", () => {
  it("needs 8 to 200 characters", () => {
    expect(passwordProblem("short")).toMatch(/8 to 200/);
    expect(passwordProblem("x".repeat(201))).toMatch(/8 to 200/);
    expect(passwordProblem("longenough")).toBeNull();
  });

  it("needs the confirmation to match", () => {
    expect(newPasswordProblem("longenough", "longenougH")).toMatch(/do not match/);
    expect(newPasswordProblem("longenough", "longenough")).toBeNull();
    expect(newPasswordProblem("short", "short")).toMatch(/8 to 200/);
  });

  it("cleans display names", () => {
    expect(cleanDisplayName("  Ada   Lovelace ")).toEqual({ name: "Ada Lovelace", error: null });
    expect(cleanDisplayName("   ")).toEqual({ name: null, error: null });
    expect(cleanDisplayName("x".repeat(81)).error).toMatch(/shorter/);
  });
});

describe("memberPasswordBlocked", () => {
  it("allows an admin to set an ordinary member's password", () => {
    expect(memberPasswordBlocked(ok)).toBeNull();
  });

  it("refuses non-admins", () => {
    expect(memberPasswordBlocked({ ...ok, actorCanManageUsers: false })).toBe(MEMBER_PASSWORD_MESSAGES.denied);
  });

  it("refuses your own account", () => {
    expect(memberPasswordBlocked({ ...ok, targetUserId: "admin" })).toBe(MEMBER_PASSWORD_MESSAGES.self);
  });

  it("refuses platform staff and super admins", () => {
    expect(memberPasswordBlocked({ ...ok, targetIsStaff: true })).toBe(MEMBER_PASSWORD_MESSAGES.staff);
  });

  it("refuses people who belong to another organization too", () => {
    expect(memberPasswordBlocked({ ...ok, targetOtherOrganizations: 1 })).toBe(MEMBER_PASSWORD_MESSAGES.otherOrganization);
  });

  it("refuses people outside this organization, impersonation and turned-off accounts", () => {
    expect(memberPasswordBlocked({ ...ok, targetIsMember: false })).toBe(MEMBER_PASSWORD_MESSAGES.notMember);
    expect(memberPasswordBlocked({ ...ok, impersonating: true })).toBe(MEMBER_PASSWORD_MESSAGES.impersonating);
    expect(memberPasswordBlocked({ ...ok, targetDisabled: true })).toBe(MEMBER_PASSWORD_MESSAGES.disabled);
  });

  it("checks permission before anything else", () => {
    expect(memberPasswordBlocked({ ...ok, actorCanManageUsers: false, targetIsStaff: true, targetUserId: "admin" })).toBe(MEMBER_PASSWORD_MESSAGES.denied);
  });
});

describe("createAttemptLimiter", () => {
  it("blocks after max failures and opens again after the window", () => {
    let now = 0;
    const limiter = createAttemptLimiter({ max: 3, windowMs: 60_000, now: () => now });
    for (let i = 0; i < 3; i += 1) {
      expect(limiter.blocked("u")).toBeNull();
      limiter.fail("u");
    }
    expect(limiter.blocked("u")).toMatch(/Try again in 1 minute\./);
    expect(limiter.blocked("other")).toBeNull();
    now = 60_001;
    expect(limiter.blocked("u")).toBeNull();
  });

  it("forgets failures after a success", () => {
    const limiter = createAttemptLimiter({ max: 1, windowMs: 60_000, now: () => 0 });
    limiter.fail("u");
    expect(limiter.blocked("u")).not.toBeNull();
    limiter.reset("u");
    expect(limiter.blocked("u")).toBeNull();
  });
});
