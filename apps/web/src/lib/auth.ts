import {
  GATE_COOKIE,
  IMPERSONATION_COOKIE,
  SESSION_COOKIE,
  authCookieBase,
  consumeMagicLink,
  createLucia,
  hashMagicLinkToken,
  issueMagicLink,
  normalizeEmail,
  openImpersonation,
  sealGate,
  sealImpersonation,
  verifyPassword,
  type MagicLinkStore,
} from "@pubcommand/auth";
import { buildSiteUrl, platformCan, PLATFORM_PERMISSIONS, safeNextUrl } from "@pubcommand/core";
import { rawPrisma } from "@pubcommand/db";
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
  async consume(tokenHash, now) {
    const record = await rawPrisma().magicLink.findUnique({ where: { tokenHash } });
    if (!record || record.consumedAt || record.expiresAt <= now) return null;
    await rawPrisma().magicLink.update({ where: { id: record.id }, data: { consumedAt: now } });
    return { userId: record.userId };
  },
};

export async function readSession() {
  const jar = await cookies();
  const sessionId = jar.get(SESSION_COOKIE)?.value ?? null;
  if (!sessionId) return { user: null, session: null };
  const auth = await lucia.validateSession(sessionId);
  if (!auth.user) return auth;
  const account = await rawPrisma().user.findUnique({ where: { id: auth.user.id }, select: { disabledAt: true } });
  if (account?.disabledAt) return { user: null, session: null };
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

export async function establishSession(userId: string) {
  const session = await lucia.createSession(userId, { mfaVerified: false });
  const cookie = lucia.createSessionCookie(session.id);
  const jar = await cookies();
  jar.set(cookie.name, cookie.value, cookie.attributes);
  const staff = await readStaff(userId);
  if (staff) {
    await writeGate({ sid: session.id, uid: userId, role: staff.role, mfa: false });
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

export function loginDestination(input: { staff: boolean; next: string | null; requestHost: string }) {
  const root = rootDomain();
  if (input.staff) {
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
  const user = await rawPrisma().user.findFirst({
    where: { email: { equals: normalizeEmail(email), mode: "insensitive" } },
  });
  if (!user) return null;
  return issueMagicLink(magicLinks, user.id);
}

export async function verifyMagicLink(token: string) {
  return consumeMagicLink(magicLinks, token);
}

export { hashMagicLinkToken, lucia, normalizeEmail, verifyPassword, sealImpersonation, secret, rootDomain };
