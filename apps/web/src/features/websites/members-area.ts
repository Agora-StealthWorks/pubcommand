import { redirect } from "next/navigation";
import { ownsPublication } from "../../../../../modules/websites/content";
import { loadSite, loadViewer } from "./public";

/** Members-area guard: the site, the signed-in member (or a redirect to sign in), and what they own. */
export async function membersPage(orgSlug: string, siteSlug: string, here: string) {
  const loaded = await loadSite(orgSlug, siteSlug);
  if (!loaded) return null;
  const { member } = await loadViewer(loaded.organizationId, loaded.site.id);
  if (!member) redirect(`${loaded.base}/sign-in?next=${encodeURIComponent(`${loaded.base}${here}`)}`);
  const owned = loaded.paid.filter((pub) => ownsPublication(member.access, pub.id));
  const locked = loaded.paid.filter((pub) => !ownsPublication(member.access, pub.id));
  return { loaded, member, owned, locked };
}
