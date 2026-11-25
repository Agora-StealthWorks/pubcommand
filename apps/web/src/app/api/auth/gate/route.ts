import { authCookieBase } from "@pubcommand/auth";
import { NextResponse, type NextRequest } from "next/server";
import { refreshGate } from "@/lib/auth";
import { GATE_RETRY_COOKIE } from "@/lib/gate-sync";

export const dynamic = "force-dynamic";

/**
 * Reissues the admin staff pass (12 h) for a session that outlived it (30 d), then
 * returns to the page. The middleware sends signed-in visitors here instead of
 * refusing them; a short retry cookie stops a redirect loop if the pass still fails.
 */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("next") ?? "/";
  const next = raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/api/auth/gate") ? raw : "/";
  const result = await refreshGate();
  const dest = request.nextUrl.clone();
  dest.search = "";
  if (result === "anonymous") {
    dest.pathname = "/login";
    dest.searchParams.set("next", next);
    return NextResponse.redirect(dest);
  }
  if (result === "not_staff") {
    return new NextResponse("Platform staff only.", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  const [pathPart, query = ""] = next.split("?");
  dest.pathname = pathPart || "/";
  dest.search = query ? `?${query}` : "";
  const response = NextResponse.redirect(dest);
  response.cookies.set(GATE_RETRY_COOKIE, "1", { ...authCookieBase(), maxAge: 20 });
  return response;
}
