/**
 * Password rules and guards for "Your account" and for org admins setting a
 * member's password. Pure: the callers look the facts up and pass them in.
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;

/** The one password rule (also used by the platform console). Returns a message, or null when it is fine. */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    return `Use ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.`;
  }
  return null;
}

/** New + confirm fields. Returns a message, or null when both are fine. */
export function newPasswordProblem(password: string, confirm: string): string | null {
  const problem = passwordProblem(password);
  if (problem) return problem;
  if (password !== confirm) return "The two new passwords do not match.";
  return null;
}

export const DISPLAY_NAME_MAX_LENGTH = 80;

/** Trims and collapses spaces. Empty means "no name". */
export function cleanDisplayName(value: string): { name: string | null; error: string | null } {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length > DISPLAY_NAME_MAX_LENGTH) return { name: null, error: "Enter a shorter name (up to 80 characters)." };
  return { name: name.length > 0 ? name : null, error: null };
}

export type MemberPasswordFacts = {
  actorUserId: string;
  targetUserId: string;
  /** The acting person may manage users in this organization (settings.users.manage). */
  actorCanManageUsers: boolean;
  /** Staff is viewing the organization as someone else. */
  impersonating: boolean;
  /** The target has a membership (active or invited) in this organization. */
  targetIsMember: boolean;
  /** The target is PubCommand platform staff (any role, including super admin). */
  targetIsStaff: boolean;
  /** Memberships the target has in other organizations (any status). */
  targetOtherOrganizations: number;
  /** The account was deleted or disabled by PubCommand. */
  targetDisabled: boolean;
};

export const MEMBER_PASSWORD_MESSAGES = {
  denied: "You do not have permission to change passwords here.",
  impersonating: "Stop viewing as someone else before changing a password.",
  self: "To change your own password, use Your account.",
  notMember: "That person is not a member of this organization.",
  staff: "This is a PubCommand staff account. Its password is managed in the PubCommand console, not here.",
  otherOrganization: "This person belongs to another organization too, so you cannot set their password here. Ask PubCommand support.",
  disabled: "This account is turned off. Ask PubCommand support.",
} as const;

/** Why an org admin may not set this member's password, or null when allowed. Order matters: the first match is shown. */
export function memberPasswordBlocked(facts: MemberPasswordFacts): string | null {
  if (!facts.actorCanManageUsers) return MEMBER_PASSWORD_MESSAGES.denied;
  if (facts.impersonating) return MEMBER_PASSWORD_MESSAGES.impersonating;
  if (facts.actorUserId === facts.targetUserId) return MEMBER_PASSWORD_MESSAGES.self;
  if (!facts.targetIsMember) return MEMBER_PASSWORD_MESSAGES.notMember;
  if (facts.targetIsStaff) return MEMBER_PASSWORD_MESSAGES.staff;
  if (facts.targetOtherOrganizations > 0) return MEMBER_PASSWORD_MESSAGES.otherOrganization;
  if (facts.targetDisabled) return MEMBER_PASSWORD_MESSAGES.disabled;
  return null;
}

// Failed-attempt throttle ------------------------------------------------------

export type AttemptLimiter = {
  /** Null when another attempt is allowed; otherwise a message saying when to try again. */
  blocked(key: string): string | null;
  /** Record a wrong password. */
  fail(key: string): void;
  /** Forget failures after a success. */
  reset(key: string): void;
};

/**
 * Counts wrong passwords per key in a sliding window. In-memory, so it limits
 * each server process (enough to stop someone guessing from an open session).
 */
export function createAttemptLimiter(options: { max: number; windowMs: number; now?: () => number }): AttemptLimiter {
  const now = options.now ?? (() => Date.now());
  const failures = new Map<string, number[]>();
  const recent = (key: string) => {
    const cutoff = now() - options.windowMs;
    const list = (failures.get(key) ?? []).filter((at) => at > cutoff);
    if (list.length > 0) failures.set(key, list);
    else failures.delete(key);
    return list;
  };
  return {
    blocked(key) {
      const list = recent(key);
      if (list.length < options.max) return null;
      const waitMs = list[0]! + options.windowMs - now();
      const minutes = Math.max(1, Math.ceil(waitMs / 60_000));
      return `Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
    },
    fail(key) {
      const list = recent(key);
      list.push(now());
      failures.set(key, list);
    },
    reset(key) {
      failures.delete(key);
    },
  };
}
