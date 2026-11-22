import { redirect } from "next/navigation";
import { SET_PASSWORD_PATH, membersGate, ownsPublication } from "../../../../../modules/websites/content";
import { loadSite, loadViewer } from "./public";

/**
 * Members-area guard: the site, the signed-in member (or a redirect to log in), and what they own.
 * A member without a password (e.g. straight after a set-password link) is sent to set one first.
 */
export async function membersPage(orgSlug: string, siteSlug: string, here: string) {
  const loaded = await loadSite(orgSlug, siteSlug);
  if (!loaded) return null;
  const viewer = await loadViewer(loaded.organizationId, loaded.site.id);
  const member = viewer.member ?? viewer.pending;
  const back = `${loaded.base}${here}`;
  const gate = membersGate(member);
  if (gate === "sign-in" || !member) redirect(`${loaded.base}/sign-in?next=${encodeURIComponent(back)}`);
  if (gate === "set-password") redirect(`${loaded.base}${SET_PASSWORD_PATH}?next=${encodeURIComponent(back)}`);
  const owned = loaded.paid.filter((pub) => ownsPublication(member.access, pub.id));
  const locked = loaded.paid.filter((pub) => !ownsPublication(member.access, pub.id));
  return { loaded, member, owned, locked };
}
