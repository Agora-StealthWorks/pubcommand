import { buildSiteUrl, resolveSite, type SiteResolution } from "@pubcommand/core";
import { headers } from "next/headers";
import { rootDomain } from "./auth";

export async function currentRequest() {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const searchText = headerList.get("x-pc-search") ?? "";
  const search = new URLSearchParams(searchText.startsWith("?") ? searchText.slice(1) : searchText);
  const site: SiteResolution = resolveSite(host, rootDomain(), search);
  return {
    host,
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
