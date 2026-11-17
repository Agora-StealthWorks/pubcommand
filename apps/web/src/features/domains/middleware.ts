/**
 * The custom-domain branch of `apps/web/src/middleware.ts`.
 *
 * A request whose host is not pubcommand.com / *.pubcommand.com (or *.localhost
 * in dev) is looked up in `custom_domains` and rewritten to
 * `/sites/public/<orgSlug><targetPath><rest>`. Only public pages are served:
 * `decideCustomHost` refuses app, admin, auth and API paths, and the rewrite
 * never targets `/sites/org` or `/sites/admin`. The session cookie is scoped to
 * the platform domain, so it never reaches a custom host anyway.
 *
 * Headers for the page (read by `currentRequest()` in `@/lib/request`):
 *   x-pc-custom-host  the custom hostname
 *   x-pc-custom-org   the org slug it belongs to
 * These are always stripped from what the client sent first.
 */

import { NextResponse, type NextRequest } from "next/server";
import { isPlatformHost } from "../../../../../modules/settings/domains/hostname";
import { decideCustomHost } from "../../../../../modules/settings/domains/routing";
import { resolveCustomHost } from "./resolve";

export const CUSTOM_HOST_HEADER = "x-pc-custom-host";
export const CUSTOM_ORG_HEADER = "x-pc-custom-org";

export function stripCustomDomainHeaders(headers: Headers): Headers {
  headers.delete(CUSTOM_HOST_HEADER);
  headers.delete(CUSTOM_ORG_HEADER);
  return headers;
}

/** Response for a host the platform does not own, or null to fall back to the 404. */
export async function customDomainResponse(request: NextRequest, host: string, rootDomain: string): Promise<NextResponse | null> {
  if (!host || isPlatformHost(host, rootDomain)) return null;
  const resolved = await resolveCustomHost(host);
  if (!resolved) return null;

  const { pathname, search } = request.nextUrl;
  const decision = decideCustomHost({
    pathname,
    search,
    orgSlug: resolved.orgSlug,
    targetPath: resolved.targetPath,
    redirectToHost: resolved.redirectToHost,
  });
  if (decision.kind === "redirect") return NextResponse.redirect(decision.location, 308);
  if (decision.kind === "not_found") return new NextResponse("Not found", { status: 404 });

  const headers = stripCustomDomainHeaders(new Headers(request.headers));
  headers.set("x-pc-pathname", decision.publicPath);
  headers.set("x-pc-search", search);
  headers.set("x-pc-site", "org");
  headers.set("x-pc-rewrite", "1");
  headers.set(CUSTOM_HOST_HEADER, host);
  headers.set(CUSTOM_ORG_HEADER, resolved.orgSlug);
  const url = request.nextUrl.clone();
  url.pathname = decision.pathname;
  return NextResponse.rewrite(url, { request: { headers } });
}
