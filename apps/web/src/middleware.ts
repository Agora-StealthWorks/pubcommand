import { GATE_COOKIE, SESSION_COOKIE, openGate } from "@pubcommand/auth/edge";
import { decideAdminAccess, resolveSite, type PlatformRole } from "@pubcommand/core";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const site = resolveSite(host, process.env.ROOT_DOMAIN ?? "localhost", request.nextUrl.searchParams);
  if (site.kind === "unknown") return new NextResponse("Unknown host", { status: 404 });

  const { pathname, search } = request.nextUrl;
  if (pathname === "/sites" || pathname.startsWith("/sites/")) return new NextResponse("Not found", { status: 404 });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pc-pathname", pathname);
  requestHeaders.set("x-pc-search", search);
  requestHeaders.set("x-pc-site", site.kind);

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
  if (pathname === "/login") url.pathname = "/sites/marketing/login";
  else if (site.kind === "marketing") url.pathname = `/sites/marketing${suffix}`;
  else if (site.kind === "app") url.pathname = `/sites/app${suffix}`;
  else if (site.kind === "admin") url.pathname = `/sites/admin${suffix}`;
  else url.pathname = `/sites/org/${site.slug}${suffix}`;

  return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
