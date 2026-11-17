import { buildSiteUrl, resolveSite, type SiteResolution } from "@pubcommand/core";
import { headers } from "next/headers";
import { rootDomain } from "./auth";

export async function currentRequest() {
  const headerList = await headers();
  const host = (headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000").split(",")[0]!.trim();
  const forwardedProto = headerList.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto = forwardedProto || (host.includes("localhost") || host.startsWith("127.") ? "http" : "https");
  const searchText = headerList.get("x-pc-search") ?? "";
  const search = new URLSearchParams(searchText.startsWith("?") ? searchText.slice(1) : searchText);
  let site: SiteResolution = resolveSite(host, rootDomain(), search);
  // A custom domain (Settings → Domains) acts as its org's host for public pages.
  // Only the middleware sets x-pc-custom-org (it strips any client copy), and only
  // for hosts the platform does not own, so an org host can never be overridden.
  const customOrg = headerList.get("x-pc-custom-org");
  const customDomain = site.kind === "unknown" && customOrg ? site.host : null;
  if (customDomain && customOrg) site = { kind: "org", slug: customOrg };
  return {
    host,
    customDomain,
    origin: `${proto}://${host}`,
    pathname: headerList.get("x-pc-pathname") ?? "/",
    search: searchText,
    site,
  };
}

export async function siteUrl(
  site: { kind: "marketing" | "app" | "admin" } | { kind: "org"; slug: string },
  pathname = "/",
) {
  const request = await currentRequest();
  return buildSiteUrl({
    rootDomain: rootDomain(),
    requestHost: request.host,
    site,
    pathname,
    search: site.kind === "org" || site.kind === "app" || site.kind === "admin" ? undefined : undefined,
  });
}
