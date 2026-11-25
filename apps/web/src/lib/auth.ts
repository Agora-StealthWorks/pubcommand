import {
  GATE_COOKIE,
  IMPERSONATION_COOKIE,
  SESSION_COOKIE,
  authCookieBase,
  consumeMagicLink,
  createLucia,
  hashMagicLinkToken,
  inspectMagicLink,
  issueMagicLink,
  normalizeEmail,
  openImpersonation,
  sealGate,
  sealImpersonation,
  verifyPassword,
  type MagicLinkStore,
} from "@pubcommand/auth";
import { buildSiteUrl, isAgentEmail, platformCan, PLATFORM_PERMISSIONS, safeNextUrl } from "@pubcommand/core";
import { activateInvitedMemberships, rawPrisma } from "@pubcommand/db";
import { cookies } from "next/headers";

const lucia = createLucia(rawPrisma());

function secret(): string {
  const value = process.env.AUTH_SECRET ?? "";
  if (value.length < 16) throw new Error("AUTH_SECRET must be at least 16 characters.");
  return value;
}

function rootDomain(): string {
  return process.env.ROOT_DOMAIN ?? "localhost";
}

const magicLinks: MagicLinkStore = {
  async save(record) {
    await rawPrisma().magicLink.create({ data: record });
  },
  async find(tokenHash) {
    return rawPrisma().magicLink.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, purpose: true, expiresAt: true, consumedAt: true },
    });
  },
  async markConsumed(id, now) {
    // Conditional update: only one request can use a token, even when two arrive together.
    const result = await rawPrisma().magicLink.updateMany({ where: { id, consumedAt: null }, data: { consumedAt: now } });
    return result.count === 1;
  },
};

export async function readSession() {
  const jar = await cookies();
  const sessionId = jar.get(SESSION_COOKIE)?.value ?? null;
  if (!sessionId) return { user: null, session: null };
  const auth = await lucia.validateSession(sessionId);
  if (!auth.user) return auth;
  const account = await rawPrisma().user.findUnique({ where: { id: auth.user.id }, select: { disabledAt: true, email: true } });
  // AI agents work only through the MCP server with their tokens, never with a browser session.
  if (account?.disabledAt || isAgentEmail(account?.email)) return { user: null, session: null };
  return auth;
}

export async function readStaff(userId: string) {
  const staff = await rawPrisma().platformStaff.findUnique({ where: { userId } });
  if (!staff || staff.disabledAt) return null;
  return staff;
}

export async function readImpersonation(staffUserId: string) {
  const token = (await cookies()).get(IMPERSONATION_COOKIE)?.value;
  if (!token) return null;
  const payload = await openImpersonation(token, secret());
  if (!payload || payload.staffUserId !== staffUserId) return null;
  const staff = await readStaff(staffUserId);
  if (!staff || !platformCan(staff.role, PLATFORM_PERMISSIONS.impersonate)) return null;
  return payload;
}

async function writeGate(input: { sid: string; uid: string; role: "SUPER_ADMIN" | "SUPPORT" | "BILLING" | "OPS"; mfa: boolean } | null) {
  const jar = await cookies();
  if (!input) {
    jar.set(GATE_COOKIE, "", { ...authCookieBase(), maxAge: 0 });
    return;
  }
  const token = await sealGate(input, secret());
  jar.set(GATE_COOKIE, token, { ...authCookieBase(), maxAge: 60 * 60 * 12 });
}

/**
 * Staff two-factor is off unless REQUIRE_STAFF_2FA=true. When off, a password or
 * magic-link sign-in is enough to open the admin console.
 */
export function staffTwoFactorRequired(): boolean {
  return process.env.REQUIRE_STAFF_2FA === "true";
}

/** True when this staff member may use the console with this session. */
export function staffReady(
  staff: { totpConfirmedAt: Date | null } | null,
  session: { mfaVerified: boolean } | null,
): boolean {
  if (!staff || !session) return false;
  if (!staffTwoFactorRequired()) return true;
  return Boolean(staff.totpConfirmedAt) && session.mfaVerified;
}

export async function establishSession(userId: string) {
  // AI agents never get a browser session (every sign-in route funnels through here).
  const account = await rawPrisma().user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!account || isAgentEmail(account.email)) throw new Error("This account cannot sign in.");
  // Signing in by any method (password or magic link) accepts pending invites.
  await activateInvitedMemberships(userId);
  const mfaVerified = !staffTwoFactorRequired();
  const session = await lucia.createSession(userId, { mfaVerified });
  const cookie = lucia.createSessionCookie(session.id);
  const jar = await cookies();
  jar.set(cookie.name, cookie.value, cookie.attributes);
  const staff = await readStaff(userId);
  if (staff) {
    await writeGate({ sid: session.id, uid: userId, role: staff.role, mfa: mfaVerified });
  } else {
    await writeGate(null);
  }
  return { session, staff };
}

export async function markSessionMfa(sessionId: string, userId: string) {
  await rawPrisma().session.update({ where: { id: sessionId }, data: { mfaVerified: true } });
  const staff = await readStaff(userId);
  if (!staff) return;
  await writeGate({ sid: sessionId, uid: userId, role: staff.role, mfa: true });
}

/**
 * Reissues the staff pass for the current session after checking the database.
 * Returns "staff" when a pass was written, "anonymous" with no session, "not_staff" otherwise.
 */
export async function refreshGate(): Promise<"staff" | "anonymous" | "not_staff"> {
  const { user, session } = await readSession();
  if (!user || !session) return "anonymous";
  const staff = await readStaff(user.id);
  if (!staff) {
    await writeGate(null);
    return "not_staff";
  }
  await writeGate({ sid: session.id, uid: user.id, role: staff.role, mfa: session.mfaVerified || !staffTwoFactorRequired() });
  return "staff";
}

export function loginDestination(input: { staff: boolean; next: string | null; requestHost: string }) {
  const root = rootDomain();
  if (input.staff && staffTwoFactorRequired()) {
    return buildSiteUrl({ rootDomain: root, requestHost: input.requestHost, site: { kind: "admin" }, pathname: "/2fa" });
  }
  return (
    safeNextUrl(input.next, root) ??
    buildSiteUrl({ rootDomain: root, requestHost: input.requestHost, site: { kind: "app" }, pathname: "/" })
  );
}

export async function logoutCurrent() {
  const { session } = await readSession();
  if (session) await lucia.invalidateSession(session.id);
  const jar = await cookies();
  const blank = lucia.createBlankSessionCookie();
  jar.set(blank.name, blank.value, blank.attributes);
  jar.set(GATE_COOKIE, "", { ...authCookieBase(), maxAge: 0 });
  jar.set(IMPERSONATION_COOKIE, "", { ...authCookieBase(), maxAge: 0 });
}

export async function createLoginLink(userId: string) {
  return issueMagicLink(magicLinks, userId);
}

export async function sendMagicLink(email: string) {
  if (isAgentEmail(email)) return null;
  const user = await rawPrisma().user.findFirst({
    where: { email: { equals: normalizeEmail(email), mode: "insensitive" } },
  });
  if (!user) return null;
  return issueMagicLink(magicLinks, user.id);
}

/** Sign-in and invite links only: a password reset token is refused here. */
export async function verifyMagicLink(token: string) {
  return consumeMagicLink(magicLinks, token, new Date(), "login");
}

// Password reset ---------------------------------------------------------------

/**
 * Issues a 30-minute, single-use reset token for an active account, or null when there is
 * no such account (callers show the same message either way). Earlier unused reset
 * tokens of that person stop working, so only the newest email is good.
 */
export async function issuePasswordReset(email: string): Promise<{ token: string; expiresAt: Date; userId: string; email: string } | null> {
  if (isAgentEmail(email)) return null;
  const user = await rawPrisma().user.findFirst({
    where: { email: { equals: normalizeEmail(email), mode: "insensitive" }, disabledAt: null, deletedAt: null },
    select: { id: true, email: true },
  });
  if (!user) return null;
  const now = new Date();
  await rawPrisma().magicLink.updateMany({
    where: { userId: user.id, purpose: "password_reset", consumedAt: null },
    data: { consumedAt: now },
  });
  const issued = await issueMagicLink(magicLinks, user.id, now, "password_reset");
  return { ...issued, userId: user.id, email: user.email };
}

/** The account a reset token belongs to, without using the token up. Null when invalid, expired, used or disabled. */
export async function checkPasswordReset(token: string): Promise<{ userId: string; email: string } | null> {
  const found = await inspectMagicLink(magicLinks, token, new Date(), "password_reset");
  if (!found) return null;
  const user = await rawPrisma().user.findUnique({ where: { id: found.userId }, select: { email: true, disabledAt: true, deletedAt: true } });
  if (!user || user.disabledAt || user.deletedAt) return null;
  return { userId: found.userId, email: user.email };
}

/** Uses up a reset token. Null when invalid, expired, already used, or not a reset token. */
export async function consumePasswordReset(token: string): Promise<{ userId: string } | null> {
  return consumeMagicLink(magicLinks, token, new Date(), "password_reset");
}

export { hashMagicLinkToken, lucia, normalizeEmail, verifyPassword, sealImpersonation, secret, rootDomain };
