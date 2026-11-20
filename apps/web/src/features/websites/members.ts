import { tenantDb } from "@pubcommand/db";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { hashPassword, verifyPassword } from "@pubcommand/auth";
import { escapeHtml, sendEmail } from "@/lib/email";
import { memberAccess, passwordProblem, sitePath, type Access } from "../../../../../modules/websites/content";
import type { SiteRow } from "./data";

/**
 * Website members are readers, not PubCommand users. They sign in with a one-time
 * emailed link; the session lives in a per-site cookie. Only token hashes are stored.
 */

const LINK_MINUTES = 30;
const SESSION_DAYS = 60;

export function memberCookieName(siteId: string): string {
  return `pc_wm_${siteId.replace(/-/g, "").slice(0, 12)}`;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * The site's own address for links in emails: its live custom domain if one
 * points at it, else the org host path (/w/<site>).
 */
export async function siteBaseUrl(organizationId: string, site: Pick<SiteRow, "slug" | "publicUrl">, fallbackOrigin: string): Promise<string> {
  // A site that runs as its own app (separate repo/Railway project) has its address in Site settings.
  if (site.publicUrl) return site.publicUrl.replace(/\/+$/, "");
  const own = sitePath(site.slug);
  const domain = await tenantDb(organizationId).customDomain.findFirst({
    where: { status: "ACTIVE", redirectToHost: null, targetPath: own },
    orderBy: { createdAt: "asc" },
    select: { hostname: true },
  });
  return domain ? `https://${domain.hostname}` : `${fallbackOrigin}${own}`;
}

export async function createSignInLink(organizationId: string, memberId: string, base: string, returnTo = "/my"): Promise<string> {
  const token = newToken();
  await tenantDb(organizationId).webMemberToken.create({
    data: { organizationId, memberId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + LINK_MINUTES * 60_000) },
  });
  const next = returnTo.startsWith("/") ? `&next=${encodeURIComponent(returnTo)}` : "";
  return `${base}/sign-in/verify?token=${token}${next}`;
}

export async function sendMemberSignInLink(input: {
  organizationId: string;
  orgSlug: string;
  site: SiteRow;
  member: { id: string; email: string; name: string };
  origin: string;
  returnTo?: string;
}): Promise<{ status: "sent" | "logged" | "failed"; link: string }> {
  const base = await siteBaseUrl(input.organizationId, input.site, input.origin);
  const link = await createSignInLink(input.organizationId, input.member.id, base, input.returnTo);
  const name = escapeHtml(input.site.name);
  const result = await sendEmail({
    to: input.member.email,
    subject: `Your sign-in link for ${input.site.name}`,
    html: `<p>Hello${input.member.name ? ` ${escapeHtml(input.member.name)}` : ""},</p><p>Click below to sign in to ${name}. The link works once and expires in ${LINK_MINUTES} minutes.</p><p><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 20px;background:#10213a;color:#f3ede1;text-decoration:none;font-weight:600">Sign in to ${name}</a></p><p style="color:#666;font-size:13px">If you did not ask for this, you can ignore this email.</p>`,
    text: `Sign in to ${input.site.name}: ${link}\n\nThe link works once and expires in ${LINK_MINUTES} minutes.`,
  });
  if (result.status === "logged") console.info(`[websites] member sign-in link (email not configured) for site ${input.site.slug}: ${link}`);
  return { status: result.status === "failed" ? "failed" : result.status, link };
}

/** Consume a link token and open a session. Returns the cookie to set, or null. */
export async function redeemSignInToken(organizationId: string, siteId: string, token: string): Promise<{ cookie: string; value: string; maxAge: number; memberId: string } | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const db = tenantDb(organizationId);
  const row = await db.webMemberToken.findFirst({ where: { tokenHash: hashToken(token) } });
  if (!row || row.usedAt || row.expiresAt <= new Date()) return null;
  const member = await db.webMember.findFirst({ where: { id: row.memberId, siteId, status: "active" } });
  if (!member) return null;
  const used = await db.webMemberToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (!used.count) return null;
  return openSession(organizationId, siteId, member.id);
}

/** Open a session for a member (after a link or a password). */
async function openSession(organizationId: string, siteId: string, memberId: string) {
  const db = tenantDb(organizationId);
  const value = newToken();
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  await db.webMemberSession.create({ data: { organizationId, memberId, tokenHash: hashToken(value), expiresAt: new Date(Date.now() + maxAge * 1000) } });
  await db.webMember.updateMany({ where: { id: memberId }, data: { lastLoginAt: new Date() } });
  return { cookie: memberCookieName(siteId), value, maxAge, memberId };
}

// Failed password attempts per site+email and per site+IP, in memory (per server). 10 per 15 minutes.
const FAIL_WINDOW_MS = 15 * 60_000;
const FAIL_LIMIT = 10;
const failures = new Map<string, number[]>();

function tooMany(key: string, now: number): boolean {
  const recent = (failures.get(key) ?? []).filter((at) => now - at < FAIL_WINDOW_MS);
  failures.set(key, recent);
  return recent.length >= FAIL_LIMIT;
}

function recordFailure(key: string, now: number) {
  failures.set(key, [...(failures.get(key) ?? []), now]);
  if (failures.size > 50_000) failures.clear();
}

export type PasswordLogin = { ok: true; session: { cookie: string; value: string; maxAge: number; memberId: string } } | { ok: false; reason: "invalid" | "limited" };

/** Email + password sign-in. One answer for "no such member", "no password yet" and "wrong password". */
export async function passwordSignIn(organizationId: string, siteId: string, email: string, password: string, ipHash: string | null): Promise<PasswordLogin> {
  const now = Date.now();
  const keys = [`${siteId}|e|${email}`, ...(ipHash ? [`${siteId}|i|${ipHash}`] : [])];
  if (keys.some((key) => tooMany(key, now))) return { ok: false, reason: "limited" };
  const member = await tenantDb(organizationId).webMember.findFirst({ where: { siteId, email, status: "active" } });
  const valid = member?.passwordHash ? await verifyPassword(password.slice(0, 200), member.passwordHash) : false;
  if (!member || !valid) {
    for (const key of keys) recordFailure(key, now);
    return { ok: false, reason: "invalid" };
  }
  for (const key of keys) failures.delete(key);
  return { ok: true, session: await openSession(organizationId, siteId, member.id) };
}

/**
 * Set or change the signed-in member's password. Changing an existing password needs the
 * current one, unless the session was opened by an emailed link in the last 30 minutes
 * (that is the "forgot password" path). Other sessions of the member are signed out.
 */
export async function setMemberPassword(
  organizationId: string,
  siteId: string,
  sessionValue: string | null | undefined,
  input: { password: unknown; currentPassword?: unknown },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!sessionValue || !/^[A-Za-z0-9_-]{20,100}$/.test(sessionValue)) return { ok: false, error: "Sign in again first." };
  const db = tenantDb(organizationId);
  const session = await db.webMemberSession.findFirst({ where: { tokenHash: hashToken(sessionValue) } });
  if (!session || session.expiresAt <= new Date()) return { ok: false, error: "Sign in again first." };
  const member = await db.webMember.findFirst({ where: { id: session.memberId, siteId, status: "active" } });
  if (!member) return { ok: false, error: "Sign in again first." };
  const problem = passwordProblem(input.password);
  if (problem) return { ok: false, error: problem };
  const fresh = Date.now() - session.createdAt.getTime() < 30 * 60_000;
  if (member.passwordHash && !fresh) {
    const current = typeof input.currentPassword === "string" ? input.currentPassword : "";
    if (!(await verifyPassword(current.slice(0, 200), member.passwordHash))) return { ok: false, error: "Your current password is not right." };
  }
  await db.webMember.updateMany({ where: { id: member.id }, data: { passwordHash: await hashPassword(input.password as string), passwordSetAt: new Date() } });
  await db.webMemberSession.deleteMany({ where: { memberId: member.id, id: { not: session.id } } });
  return { ok: true };
}

export async function endSession(organizationId: string, siteId: string, value: string | undefined): Promise<void> {
  if (!value) return;
  await tenantDb(organizationId).webMemberSession.deleteMany({ where: { tokenHash: hashToken(value) } });
  void siteId;
}

export type SignedInMember = { id: string; email: string; name: string; hasPassword: boolean; access: Access; createdAt: Date; entitlements: { id: string; productId: string; status: string; startsAt: Date; endsAt: Date | null; source: string }[] };

/** The member signed in on this site (from the cookie), with what they can read today. */
export async function readMember(organizationId: string, siteId: string, now = new Date()): Promise<SignedInMember | null> {
  return readMemberByToken(organizationId, siteId, (await cookies()).get(memberCookieName(siteId))?.value, now);
}

/** The member for a session token (the separate site app sends it with each API call). */
export async function readMemberByToken(organizationId: string, siteId: string, value: string | null | undefined, now = new Date()): Promise<SignedInMember | null> {
  if (!value || !/^[A-Za-z0-9_-]{20,100}$/.test(value)) return null;
  const db = tenantDb(organizationId);
  const session = await db.webMemberSession.findFirst({ where: { tokenHash: hashToken(value) } });
  if (!session || session.expiresAt <= now) return null;
  const member = await db.webMember.findFirst({ where: { id: session.memberId, siteId, status: "active" } });
  if (!member) return null;
  const [entitlements, products] = await Promise.all([
    db.webEntitlement.findMany({ where: { memberId: member.id }, select: { id: true, productId: true, status: true, startsAt: true, endsAt: true, source: true } }),
    db.webProduct.findMany({ where: { siteId }, select: { id: true, publicationIds: true, allPublications: true, active: true } }),
  ]);
  return { id: member.id, email: member.email, name: member.name, hasPassword: Boolean(member.passwordHash), createdAt: member.createdAt, entitlements, access: memberAccess(entitlements, products, now) };
}
