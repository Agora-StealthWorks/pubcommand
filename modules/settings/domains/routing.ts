/**
 * How a request on a custom domain becomes a public page. Pure: the middleware
 * calls this after it has looked the host up in `custom_domains`.
 *
 * A custom domain only ever serves an organization's PUBLIC pages, which live
 * under `/sites/public/<orgSlug>/…`. The signed-in app, the admin console and
 * `/api` are never reachable on a custom host.
 */

/**
 * First path segments of public pages on an org host, and the path each maps to
 * under `/sites/public/<orgSlug>`. Keep in step with `apps/web/src/middleware.ts`
 * (org-host branch).
 *
 * - `/f/<form>`, `/embed/<form>`: Forms (built).
 * - `/p/...`: token pages such as CUB review links; `/p` is dropped internally.
 * - `/l/<funnel>/...`: launch funnels.
 * - `/b/<site>/...`: Mini-Blogs (canonical).
 * - `/t/<site>/...`: Mini-Blogs under their old text-letter path (kept so old links work).
 * - `/w/<site>/...`: Websites (public site and members area).
 */
export const PUBLIC_PREFIXES = ["f", "embed", "p", "l", "b", "t", "w"] as const;
export type PublicPrefix = (typeof PUBLIC_PREFIXES)[number];

/** Prefixes a domain may point at. `/p/` links are single-use tokens, so not a target. */
export const TARGET_PREFIXES: readonly PublicPrefix[] = ["f", "embed", "l", "b", "t", "w"];

/**
 * Paths refused outright on a custom host, even though joining them onto the
 * target would usually just 404: an explicit refusal keeps app, auth, admin and
 * API surfaces off customer domains no matter what the target is.
 */
export const REFUSED_PREFIXES = [
  "api",
  "sites",
  "login",
  "logout",
  "auth",
  "2fa",
  "viewport",
  "settings",
  "admin",
  "_next",
] as const;

const SEGMENT = /^[a-z0-9][a-z0-9._~-]*$/i;

export type TargetPathCheck = { ok: true; path: string } | { ok: false; reason: string };

/** Validates the path a domain points at, e.g. "/f/my-form" or "l/my-launch/". */
export function normalizeTargetPath(input: string): TargetPathCheck {
  let value = input.trim();
  if (!value) return { ok: false, reason: "Choose a page for this domain." };
  if (/^https?:\/\//i.test(value)) {
    try {
      value = new URL(value).pathname;
    } catch {
      return { ok: false, reason: "That is not a valid path." };
    }
  }
  if (/[?#]/.test(value)) return { ok: false, reason: "Leave out the ? and # parts; use a plain path." };
  if (!value.startsWith("/")) value = `/${value}`;
  const segments = value.split("/").filter(Boolean);
  if (segments.length < 2) return { ok: false, reason: "Point at a specific page, like /f/my-form." };
  if (!segments.every((segment) => SEGMENT.test(segment) && segment !== "." && segment !== "..")) {
    return { ok: false, reason: "Use letters, numbers and hyphens only in the path." };
  }
  const prefix = segments[0]!.toLowerCase() as PublicPrefix;
  if (!TARGET_PREFIXES.includes(prefix)) {
    return { ok: false, reason: `A domain can point at a public page: ${TARGET_PREFIXES.map((item) => `/${item}/…`).join(", ")}.` };
  }
  segments[0] = prefix;
  const path = `/${segments.join("/")}`;
  if (path.length > 300) return { ok: false, reason: "That path is too long." };
  return { ok: true, path };
}

/** Joins a target path and a request path without doubling or losing slashes. */
export function joinPath(base: string, rest: string): string {
  const left = base.replace(/\/+$/, "");
  const right = rest.replace(/^\/+/, "");
  if (!right) return left || "/";
  return `${left}/${right}`;
}

function firstSegment(pathname: string): string {
  return (pathname.split("/")[1] ?? "").toLowerCase();
}

/** An org-host public path → the internal route, e.g. /p/cub/r/x → /sites/public/acme/cub/r/x. */
export function publicInternalPath(orgSlug: string, publicPath: string): string {
  const segment = firstSegment(publicPath);
  const inner = segment === "p" ? publicPath.slice(2) || "" : publicPath;
  return `/sites/public/${orgSlug}${inner === "/" ? "" : inner}`;
}

export type CustomHostDecision =
  | { kind: "rewrite"; pathname: string; publicPath: string }
  | { kind: "redirect"; location: string }
  | { kind: "not_found" };

/**
 * Decide what a custom-domain request serves.
 *
 * - A path that already starts with a public prefix (`/f/x/submit`,
 *   `/b/site/post`) is an absolute public path of the same organization and is
 *   served as-is. That is what makes links, form submits, logos and embeds
 *   inside public pages work, since those pages use org-relative URLs.
 * - Anything else is joined onto the target: `/` → the target itself,
 *   `/day-2` on a `/l/launch` domain → `/l/launch/day-2`.
 * - App, admin, auth and API paths are refused.
 *
 * Caveat: a page slug that equals a public prefix (a Mini-Blog post called
 * "f") is read as an absolute path. Such a page is still reachable at its full
 * path, e.g. `/b/site/f`.
 */
export function decideCustomHost(input: {
  pathname: string;
  search?: string;
  orgSlug: string;
  targetPath: string;
  redirectToHost?: string | null;
}): CustomHostDecision {
  const { pathname, orgSlug, targetPath } = input;
  if (input.redirectToHost) {
    return { kind: "redirect", location: `https://${input.redirectToHost}${pathname}${input.search ?? ""}` };
  }
  if (!pathname.startsWith("/") || pathname.includes("//") || /(^|\/)\.\.?(\/|$)/.test(pathname) || pathname.includes("\\")) {
    return { kind: "not_found" };
  }
  const segment = firstSegment(pathname);
  if ((REFUSED_PREFIXES as readonly string[]).includes(segment)) return { kind: "not_found" };
  const target = normalizeTargetPath(targetPath);
  if (!target.ok) return { kind: "not_found" };
  const publicPath = (PUBLIC_PREFIXES as readonly string[]).includes(segment) && pathname.split("/").length > 2
    ? pathname
    : joinPath(target.path, pathname);
  return { kind: "rewrite", pathname: publicInternalPath(orgSlug, publicPath), publicPath };
}
