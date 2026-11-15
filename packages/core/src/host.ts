export type SiteResolution =
  | { kind: "marketing" }
  | { kind: "app" }
  | { kind: "admin" }
  | { kind: "org"; slug: string }
  | { kind: "unknown"; host: string };

export function stripPort(host: string): string {
  const value = host.trim().toLowerCase();
  if (value.startsWith("[")) return value;
  const index = value.lastIndexOf(":");
  if (index > -1 && /^\d+$/.test(value.slice(index + 1))) return value.slice(0, index);
  return value;
}

function normalizeRoot(rootDomain: string): string {
  return rootDomain.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
}

/**
 * Resolve the public host to a site. `?org=` and `?site=` apply only on a bare
 * localhost dev host. A production host is never overridden by the query string.
 */
export function resolveSite(
  hostHeader: string | null,
  rootDomain: string,
  search?: URLSearchParams,
): SiteResolution {
  const host = stripPort(hostHeader ?? "");
  const root = normalizeRoot(rootDomain);

  if (host === "localhost" || host === "127.0.0.1") {
    const org = search?.get("org")?.trim().toLowerCase() ?? "";
    if (org) return { kind: "org", slug: org };
    const site = search?.get("site")?.trim().toLowerCase() ?? "";
    if (site === "admin") return { kind: "admin" };
    if (site === "app") return { kind: "app" };
    return { kind: "marketing" };
  }

  if (host.endsWith(".localhost")) {
    const label = host.slice(0, -".localhost".length);
    if (!label || label.includes(".")) return { kind: "unknown", host };
    if (label === "www") return { kind: "marketing" };
    if (label === "app") return { kind: "app" };
    if (label === "admin") return { kind: "admin" };
    return { kind: "org", slug: label };
  }

  if (!host || !root || host === root || host === `www.${root}`) return { kind: "marketing" };
  if (host === `app.${root}`) return { kind: "app" };
  if (host === `admin.${root}`) return { kind: "admin" };

  const suffix = `.${root}`;
  if (host.endsWith(suffix)) {
    const label = host.slice(0, -suffix.length);
    if (!label || label.includes(".")) return { kind: "unknown", host };
    return { kind: "org", slug: label };
  }

  return { kind: "unknown", host };
}

export type SiteTarget =
  | { kind: "marketing" }
  | { kind: "app" }
  | { kind: "admin" }
  | { kind: "org"; slug: string };

function splitHost(hostHeader: string): { bare: string; port: string } {
  const host = hostHeader.trim().toLowerCase();
  const bare = stripPort(host);
  const port = host.length > bare.length ? host.slice(bare.length) : "";
  return { bare, port };
}

function localPort(port: string): string {
  return port || ":3000";
}

export function buildSiteUrl(input: {
  rootDomain: string;
  requestHost: string;
  site: SiteTarget;
  pathname?: string;
  search?: string;
}): string {
  const pathname = !input.pathname || input.pathname === "/" ? "/" : input.pathname;
  const path = pathname === "/" ? "" : pathname;
  const { bare, port } = splitHost(input.requestHost || "localhost:3000");
  const root = normalizeRoot(input.rootDomain);
  const bareLocal = bare === "localhost" || bare === "127.0.0.1";
  const subdomainLocal = bare.endsWith(".localhost");

  if (bareLocal || root === "localhost" || root === "127.0.0.1") {
    const params = new URLSearchParams((input.search ?? "").replace(/^\?/, ""));
    params.delete("org");
    params.delete("site");
    if (input.site.kind === "org") params.set("org", input.site.slug);
    if (input.site.kind === "app") params.set("site", "app");
    if (input.site.kind === "admin") params.set("site", "admin");
    const query = params.toString();
    const hostName = bare === "127.0.0.1" ? "127.0.0.1" : "localhost";
    return `http://${hostName}${localPort(port)}${pathname}${query ? `?${query}` : ""}`;
  }

  if (subdomainLocal) {
    const suffix = localPort(port);
    if (input.site.kind === "marketing") return `http://localhost${suffix}${pathname}${input.search ?? ""}`;
    if (input.site.kind === "app") return `http://app.localhost${suffix}${pathname}${input.search ?? ""}`;
    if (input.site.kind === "admin") return `http://admin.localhost${suffix}${pathname}${input.search ?? ""}`;
    return `http://${input.site.slug}.localhost${suffix}${pathname}${input.search ?? ""}`;
  }

  const search = input.search ?? "";
  if (input.site.kind === "marketing") return `https://${root}${path}${search}`;
  if (input.site.kind === "app") return `https://app.${root}${path}${search}`;
  if (input.site.kind === "admin") return `https://admin.${root}${path}${search}`;
  return `https://${input.site.slug}.${root}${path}${search}`;
}

export function safeNextUrl(next: string | null, rootDomain: string): string | null {
  if (!next) return null;
  if (next.startsWith("/") && !next.startsWith("//")) return next;
  try {
    const url = new URL(next);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase();
    const root = normalizeRoot(rootDomain);
    const allowed =
      host === root ||
      host.endsWith(`.${root}`) ||
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.endsWith(".localhost");
    if (!allowed) return null;
    return url.toString();
  } catch {
    return null;
  }
}
