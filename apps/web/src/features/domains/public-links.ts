import { buildSiteUrl } from "@pubcommand/core";
import { tenantDb } from "@pubcommand/db";
import { cache } from "react";
import { rootDomain } from "@/lib/auth";
import { withPreview } from "@/lib/preview-token";
import { customDomainUrl, type LinkDomain } from "../../../../../modules/settings/domains/links";

/**
 * Public links for the admin (and anything we copy elsewhere, like Calendar
 * issues): a page's custom domain when one is set up and Active (Settings →
 * Domains), the organization's PubCommand address only when there is none.
 */

/** The organization's Active custom domains (not the www → apex redirects), oldest first. Cached per request. */
export const loadLinkDomains = cache(async (organizationId: string): Promise<LinkDomain[]> => {
  const rows = await tenantDb(organizationId).customDomain.findMany({
    where: { status: "ACTIVE", redirectToHost: null },
    orderBy: { createdAt: "asc" },
    select: { hostname: true, targetPath: true },
  });
  return rows;
});

export type PublicLinker = {
  /** Absolute public URL for a public path like `/b/digest/post` (query allowed). */
  url: (pathWithQuery: string) => string;
  /** The same, as a Preview link: `preview=1` plus a signed token for `scope` so it works on a custom domain too. */
  preview: (pathWithQuery: string, scope: string, extra?: Record<string, string>) => string;
  /** True when the path is served on a custom domain. */
  onCustomDomain: (path: string) => boolean;
};

export async function publicLinker(input: { organizationId: string; orgSlug: string; requestHost: string }): Promise<PublicLinker> {
  const domains = await loadLinkDomains(input.organizationId);
  const url = (pathWithQuery: string) => {
    const custom = customDomainUrl(domains, pathWithQuery);
    if (custom) return custom;
    const [pathname = "/", query = ""] = pathWithQuery.split(/\?(.*)/s);
    return buildSiteUrl({ rootDomain: rootDomain(), requestHost: input.requestHost, site: { kind: "org", slug: input.orgSlug }, pathname, search: query ? `?${query}` : undefined });
  };
  return {
    url,
    preview: (pathWithQuery, scope, extra = {}) => withPreview(url(pathWithQuery), input.organizationId, scope, extra),
    onCustomDomain: (path) => customDomainUrl(domains, path) !== null,
  };
}
