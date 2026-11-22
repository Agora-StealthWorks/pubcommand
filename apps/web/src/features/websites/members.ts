import { buildSiteUrl } from "@pubcommand/core";
import { rawPrisma, tenantDb } from "@pubcommand/db";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { hashPassword, verifyPassword } from "@pubcommand/auth";
import { sendOrgEmail } from "@/features/email/org-email";
import { LINK_MINUTES, memberAccess, passwordProblem, setPasswordEmail, sitePath, themeFrom, type Access } from "../../../../../modules/websites/content";
import type { SiteRow } from "./data";

/**
 * Website members are readers, not staff users. They log in with email + password; an
 * emailed one-time link only lets them set (or reset) the password. The session lives in a
 * per-site cookie (or, for a site that runs as its own app, in the x-member-session header).
 * Only token hashes are stored.
 */

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

/** A one-time link that signs the member in on a "link" session and leads to the set-password page. */
export async function createSetPasswordLink(organizationId: string, memberId: string, base: string, returnTo = "/my"): Promise<string> {
  const token = newToken();
  await tenantDb(organizationId).webMemberToken.create({
    data: { organizationId, memberId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + LINK_MINUTES * 60_000) },
  });
  const next = returnTo.startsWith("/") ? `&next=${encodeURIComponent(returnTo)}` : "";
  return `${base}/sign-in/verify?token=${token}${next}`;
}

const EMAIL_IMAGE_MIME = /^image\/(png|jpe?g|gif)$/i;

/**
 * Logo and button colour for member emails, from the site and the brand defaults in Publication
 * Setup (never PubCommand's). The logo is the site's own light-background logo, else the brand
 * logo, served by the site's /logo route on the org host. No logo when there is none or it is an
 * SVG/WebP (many email clients block those): the email then shows the site's name.
 */
async function siteEmailLook(organizationId: string, site: SiteRow, origin: string): Promise<{ logoUrl: string | null; accent: string }> {
  const db = tenantDb(organizationId);
  // The email's header band is the site's dark primary colour, so use the logo made for dark backgrounds.
  const ownId = site.logoAssetId ?? site.logoLightAssetId;
  const [own, branding] = await Promise.all([
    ownId ? db.webAsset.findFirst({ where: { id: ownId, siteId: site.id }, select: { mimeType: true } }) : null,
    db.pubBrandBranding.findFirst({ where: { brandId: site.brandId }, select: { logoMime: true, logoOnDarkMime: true, primaryColor: true } }),
  ]);
  const accent = branding?.primaryColor && /^#[0-9a-f]{6}$/i.test(branding.primaryColor) ? branding.primaryColor : themeFrom(site.theme).primary;
  const mime = own?.mimeType ?? branding?.logoOnDarkMime ?? branding?.logoMime ?? null;
  if (!mime || !EMAIL_IMAGE_MIME.test(mime)) return { logoUrl: null, accent };
  const organization = await rawPrisma().organization.findUnique({ where: { id: organizationId }, select: { slug: true } });
  let requestHost: string | null = null;
  try {
    requestHost = new URL(origin).host;
  } catch {
    requestHost = null;
  }
  if (!organization || !requestHost) return { logoUrl: null, accent };
  const logoUrl = buildSiteUrl({ rootDomain: process.env.ROOT_DOMAIN ?? "localhost", requestHost, site: { kind: "org", slug: organization.slug }, pathname: `${sitePath(site.slug)}/logo`, search: "?bg=dark" });
  return { logoUrl, accent };
}

/** The publication a member email is about, from the page they were on (…/research/<slug> or …/newsletters/<slug>). */
export async function publicationFromPath(organizationId: string, brandId: string, path: string | null | undefined): Promise<string | null> {
  const slug = /\/(?:research|newsletters)\/([a-z0-9-]{1,80})(?:[/?#]|$)/.exec(path ?? "")?.[1];
  if (!slug) return null;
  const pub = await tenantDb(organizationId).calendarPublication.findFirst({ where: { brandId, slug }, select: { id: true } });
  return pub?.id ?? null;
}

/**
 * Email a member the "Set your password for <site>" link, through the organization's email
 * (Settings → Email): the publication's sender when the request came from a publication's page,
 * else the brand's, else the organization default; the org's Resend key, else PubCommand's.
 */
export async function sendSetPasswordLink(input: {
  organizationId: string;
  site: SiteRow;
  member: { id: string; email: string; name: string };
  origin: string;
  returnTo?: string;
  publicationId?: string | null;
}): Promise<{ status: "sent" | "logged" | "failed"; link: string }> {
  const base = await siteBaseUrl(input.organizationId, input.site, input.origin);
  const link = await createSetPasswordLink(input.organizationId, input.member.id, base, input.returnTo);
  const [look, publicationId] = await Promise.all([
    siteEmailLook(input.organizationId, input.site, input.origin).catch(() => ({ logoUrl: null, accent: themeFrom(input.site.theme).primary })),
    input.publicationId !== undefined ? input.publicationId : publicationFromPath(input.organizationId, input.site.brandId, input.returnTo),
  ]);
  const email = setPasswordEmail({ siteName: input.site.name, memberName: input.member.name, link, accent: look.accent, logoUrl: look.logoUrl, theme: themeFrom(input.site.theme), supportEmail: input.site.supportEmail });
  const result = await sendOrgEmail({
    organizationId: input.organizationId,
    brandId: input.site.brandId,
    publicationId,
    displayName: input.site.name,
    to: input.member.email,
    ...email,
  });
  if (result.status === "logged") console.info(`[websites] set-password link (email not configured) for site ${input.site.slug}: ${link}`);
  return { status: result.status === "failed" ? "failed" : result.status, link };
}

/** Consume a set-password link and open a "link" session. Returns the cookie to set, or null. */
export async function redeemSignInToken(organizationId: string, siteId: string, token: string): Promise<{ cookie: string; value: string; maxAge: number; memberId: string; hasPassword: boolean } | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const db = tenantDb(organizationId);
  const row = await db.webMemberToken.findFirst({ where: { tokenHash: hashToken(token) } });
  if (!row || row.usedAt || row.expiresAt <= new Date()) return null;
  const member = await db.webMember.findFirst({ where: { id: row.memberId, siteId, status: "active" } });
  if (!member) return null;
  const used = await db.webMemberToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (!used.count) return null;
  return { ...(await openSession(organizationId, siteId, member.id, "link")), hasPassword: Boolean(member.passwordHash) };
}

/** Open a session for a member (after a password login, or a set-password link). */
async function openSession(organizationId: string, siteId: string, memberId: string, method: "password" | "link") {
  const db = tenantDb(organizationId);
  const value = newToken();
  // A link session only needs to live long enough to set a password; it is extended once one is set.
  const maxAge = method === "link" ? LINK_MINUTES * 2 * 60 : SESSION_DAYS * 24 * 60 * 60;
  await db.webMemberSession.create({ data: { organizationId, memberId, tokenHash: hashToken(value), method, expiresAt: new Date(Date.now() + maxAge * 1000) } });
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
  return { ok: true, session: await openSession(organizationId, siteId, member.id, "password") };
}

/**
 * Set or change the signed-in member's password. Changing an existing password needs the
 * current one, unless the session was opened by a set-password link in the last 30 minutes
 * (the "forgot password" path; it works once: the session becomes a normal one). Other
 * sessions of the member are signed out. Returns the session's new lifetime in seconds.
 */
export async function setMemberPassword(
  organizationId: string,
  siteId: string,
  sessionValue: string | null | undefined,
  input: { password: unknown; currentPassword?: unknown },
): Promise<{ ok: true; maxAge: number } | { ok: false; error: string }> {
  if (!sessionValue || !/^[A-Za-z0-9_-]{20,100}$/.test(sessionValue)) return { ok: false, error: "Sign in again first." };
  const db = tenantDb(organizationId);
  const session = await db.webMemberSession.findFirst({ where: { tokenHash: hashToken(sessionValue) } });
  if (!session || session.expiresAt <= new Date()) return { ok: false, error: "Sign in again first." };
  const member = await db.webMember.findFirst({ where: { id: session.memberId, siteId, status: "active" } });
  if (!member) return { ok: false, error: "Sign in again first." };
  const problem = passwordProblem(input.password);
  if (problem) return { ok: false, error: problem };
  const freshLink = session.method === "link" && Date.now() - session.createdAt.getTime() < LINK_MINUTES * 60_000;
  if (member.passwordHash && !freshLink) {
    const current = typeof input.currentPassword === "string" ? input.currentPassword : "";
    if (!(await verifyPassword(current.slice(0, 200), member.passwordHash))) return { ok: false, error: "Your current password is not right." };
  }
  await db.webMember.updateMany({ where: { id: member.id }, data: { passwordHash: await hashPassword(input.password as string), passwordSetAt: new Date() } });
  await db.webMemberSession.deleteMany({ where: { memberId: member.id, id: { not: session.id } } });
  // This session is now a normal signed-in one.
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  await db.webMemberSession.updateMany({ where: { id: session.id }, data: { method: "password", expiresAt: new Date(Date.now() + maxAge * 1000) } });
  return { ok: true, maxAge };
}

/** Staff set a member's password (Websites → Members). Signs the member out everywhere. */
export async function adminSetMemberPassword(organizationId: string, memberId: string, password: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const problem = passwordProblem(password);
  if (problem) return { ok: false, error: problem };
  const db = tenantDb(organizationId);
  await db.webMember.updateMany({ where: { id: memberId }, data: { passwordHash: await hashPassword(password as string), passwordSetAt: new Date() } });
  await db.webMemberSession.deleteMany({ where: { memberId } });
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
