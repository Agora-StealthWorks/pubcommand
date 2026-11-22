import { GATE_COOKIE, SESSION_COOKIE, openGate } from "@pubcommand/auth/edge";
import { decideAdminAccess, resolveSite, type PlatformRole } from "@pubcommand/core";
import { NextResponse, type NextRequest } from "next/server";
import { customDomainResponse, stripCustomDomainHeaders } from "./features/domains/middleware";

export async function middleware(request: NextRequest) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const rootDomain = process.env.ROOT_DOMAIN ?? "localhost";
  const site = resolveSite(host, rootDomain, request.nextUrl.searchParams);
  if (site.kind === "unknown") {
    // Custom domains (Settings → Domains): a host we do not own may be an org's
    // custom domain, which serves only that org's public pages. Anything else
    // stays a 404. See features/domains/middleware.ts.
    const custom = await customDomainResponse(request, site.host, rootDomain);
    return custom ?? new NextResponse("Unknown host", { status: 404 });
  }

  const { pathname, search } = request.nextUrl;
  // Internal /sites/* paths are only reached through the rewrites below. Middleware
  // never runs on its own rewrites, so a request that arrives here for /sites came
  // from outside. Refuse it even if it carries our internal header.
  if (pathname === "/sites" || pathname.startsWith("/sites/")) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Custom-domain headers are only ever set by customDomainResponse above.
  const requestHeaders = stripCustomDomainHeaders(new Headers(request.headers));
  requestHeaders.set("x-pc-pathname", pathname);
  requestHeaders.set("x-pc-search", search);
  requestHeaders.set("x-pc-site", site.kind);
  requestHeaders.set("x-pc-rewrite", "1");

  if (pathname === "/viewport" || pathname.startsWith("/viewport/")) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  if (site.kind === "admin") {
    const secret = process.env.AUTH_SECRET ?? "";
    const token = request.cookies.get(GATE_COOKIE)?.value;
    const gate = secret && token ? await openGate(token, secret) : null;
    const decision = decideAdminAccess({
      pathname,
      hasSession: Boolean(request.cookies.get(SESSION_COOKIE)?.value),
      staffRole: (gate?.role as PlatformRole | undefined) ?? null,
      mfaVerified: Boolean(gate?.mfa),
    });
    if (decision.type === "reject") {
      return new NextResponse("Platform staff only.", {
        status: 403,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    if (decision.type === "login") {
      const login = request.nextUrl.clone();
      login.pathname = "/login";
      login.search = `?next=${encodeURIComponent(pathname + search)}`;
      return NextResponse.redirect(login);
    }
    if (decision.type === "mfa" && pathname !== "/2fa") {
      const enroll = request.nextUrl.clone();
      enroll.pathname = "/2fa";
      enroll.search = "";
      return NextResponse.redirect(enroll);
    }
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const url = request.nextUrl.clone();
  const suffix = pathname === "/" ? "" : pathname;
  // Sign-in pages work on every host (org, app, admin): /login and the "Forgot your password?" reset page.
  if (pathname === "/login") url.pathname = "/sites/marketing/login";
  else if (pathname === "/reset-password") url.pathname = "/sites/marketing/reset-password";
  else if (site.kind === "marketing") url.pathname = `/sites/marketing${suffix}`;
  else if (site.kind === "app") url.pathname = `/sites/app${suffix}`;
  else if (site.kind === "admin") url.pathname = `/sites/admin${suffix}`;
  // Public pages on an org host work without sign-in, so they live outside the org
  // layout that sends anonymous visitors to the login page.
  // /p/... are token-gated pages (e.g. CUB review links) → /sites/public/<slug>/...
  else if (pathname === "/p" || pathname.startsWith("/p/")) url.pathname = `/sites/public/${site.slug}${pathname.slice(2)}`;
  // /f/<form> and /embed/<form> are public form links.
  else if (/^\/(f|embed)\/[a-z0-9-]/.test(pathname)) url.pathname = `/sites/public/${site.slug}${pathname}`;
  // /l/<funnel> are public launch funnels; /b/<site> are public Mini-Blogs (/t/<site> is their old path);
  // /w/<site> are public websites (Websites app).
  else if (/^\/(l|b|t|w)\/[a-z0-9-]/.test(pathname)) url.pathname = `/sites/public/${site.slug}${pathname}`;
  else url.pathname = `/sites/org/${site.slug}${suffix}`;

  return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
}

export const config = {
  // Node.js runtime (stable in Next 15.5) so the custom-domain lookup can use
  // Prisma in-process with a small in-memory cache; Edge cannot reach the DB.
  runtime: "nodejs",
  // /brand/* is PubCommand's own logo and icons (apps/web/public/brand), served as static files on every host.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/).*)"],
};
