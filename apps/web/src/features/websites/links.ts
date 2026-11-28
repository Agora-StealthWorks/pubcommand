import { currentRequest } from "@/lib/request";
import { publicLinker } from "../domains/public-links";

/**
 * A website's public links for the admin: its custom domain when one is Active
 * (Settings → Domains), the organization's PubCommand address only when there
 * is none. Previews carry a signed token, so they open on a custom domain too.
 */
export async function websiteLinks(site: { id: string; slug: string; organizationId: string; status: string }) {
  const request = await currentRequest();
  const orgSlug = request.site.kind === "org" ? request.site.slug : "";
  const links = await publicLinker({ organizationId: site.organizationId, orgSlug, requestHost: request.host });
  const base = `/w/${site.slug}`;
  const scope = `website:${site.id}`;
  return {
    /** The site; a preview link while it is not live (so it opens for you before launch). */
    site: site.status === "live" ? links.url(base) : links.preview(base, scope),
    members: links.url(`${base}/my`),
    /** A post or page, as a preview (drafts and scheduled posts open too). */
    preview: (postSlug: string) => links.preview(`${base}/${postSlug}`, scope),
  };
}
