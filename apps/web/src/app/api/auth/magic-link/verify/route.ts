import { buildSiteUrl, resolveSite } from "@pubcommand/core";
import { rawPrisma } from "@pubcommand/db";
import { NextResponse } from "next/server";
import { establishSession, loginDestination, rootDomain, staffTwoFactorRequired, verifyMagicLink } from "@/lib/auth";

/**
 * Someone who arrived by a link (an invite) and has no password yet goes to Your account to set one,
 * because email sign-in is usually off and they would otherwise be locked out next time.
 * Prefers the organization whose address the link was opened on.
 */
async function setPasswordDestination(userId: string, requestHost: string, origin: string, search: URLSearchParams): Promise<string | null> {
  const memberships = await rawPrisma().membership.findMany({
    where: { userId, status: "ACTIVE", organization: { deletedAt: null, suspendedAt: null } },
    select: { organization: { select: { slug: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (memberships.length === 0) return null;
  const site = resolveSite(requestHost, rootDomain(), search);
  const here = site.kind === "org" ? memberships.find((row) => row.organization.slug === site.slug) : undefined;
  // Same host as the link: stay on it (the session cookie was just set here).
  if (here) return new URL(`/account?welcome=1${search.get("org") ? `&org=${encodeURIComponent(here.organization.slug)}` : ""}`, origin).toString();
  const slug = memberships[0]!.organization.slug;
  return buildSiteUrl({ rootDomain: rootDomain(), requestHost, site: { kind: "org", slug }, pathname: "/account", search: "?welcome=1" });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const next = url.searchParams.get("next");
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "localhost:3000").split(",")[0]!.trim();
  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  const origin = `${proto}://${host}`;
  const consumed = await verifyMagicLink(token);
  if (!consumed) return NextResponse.redirect(new URL("/login?error=That sign-in link is invalid or expired.", origin));
  const account = await rawPrisma().user.findUnique({ where: { id: consumed.userId }, select: { disabledAt: true, passwordHash: true } });
  if (!account || account.disabledAt) {
    return NextResponse.redirect(new URL("/login?error=This account is disabled.", origin));
  }
  const { staff } = await establishSession(consumed.userId);
  // Staff who still need two-factor finish that first; everyone else without a password sets one.
  const needsTwoFactor = Boolean(staff) && staffTwoFactorRequired();
  const setPassword = !account.passwordHash && !needsTwoFactor ? await setPasswordDestination(consumed.userId, host, origin, url.searchParams) : null;
  return NextResponse.redirect(setPassword ?? loginDestination({ staff: Boolean(staff), next, requestHost: host }));
}
