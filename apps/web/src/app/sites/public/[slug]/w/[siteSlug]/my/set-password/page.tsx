import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PASSWORD_FORM_ERRORS, PASSWORD_MIN, safeReturnPath } from "../../../../../../../../../../../modules/websites/content";
import { loadSite, loadViewer } from "@/features/websites/public";
import { SiteShell } from "@/features/websites/site-view";

type Params = Promise<{ slug: string; siteSlug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, siteSlug } = await params;
  const loaded = await loadSite(slug, siteSlug);
  return { title: { absolute: loaded ? `Set your password | ${loaded.site.name}` : "Not found" }, robots: { index: false } };
}


/** Where a set-password link lands. Every members-area page sends a member without a password here. */
export default async function SetPasswordPage({ params, searchParams }: { params: Params; searchParams: Promise<{ next?: string; error?: string }> }) {
  const { slug, siteSlug } = await params;
  const query = await searchParams;
  const loaded = await loadSite(slug, siteSlug);
  if (!loaded) notFound();
  const { member, pending } = await loadViewer(loaded.organizationId, loaded.site.id);
  const next = safeReturnPath(query.next, `${loaded.base}/my`);
  const who = pending ?? member;
  if (!who) redirect(`${loaded.base}/sign-in?forgot=1&next=${encodeURIComponent(next)}`);
  const { base, site } = loaded;
  return (
    <SiteShell loaded={loaded} member={member}>
      <div className="auth">
        <span className="label">Members</span>
        <h1>{who.hasPassword ? "Choose a new password" : "Set your password"}</h1>
        <p>
          For {who.email}. You&apos;ll use it to log in to {site.name}. At least {PASSWORD_MIN} characters.
        </p>
        {query.error && PASSWORD_FORM_ERRORS[query.error] ? <p className="note-err">{PASSWORD_FORM_ERRORS[query.error]}</p> : null}
        <form method="post" action={`${base}/my/set-password/submit`}>
          <input type="hidden" name="next" value={next} />
          <input type="text" name="username" value={who.email} autoComplete="username" readOnly hidden />
          <label htmlFor="new-password" style={{ fontSize: 14, fontWeight: 600 }}>
            New password
          </label>
          <input id="new-password" className="field" type="password" name="password" required minLength={PASSWORD_MIN} maxLength={200} autoComplete="new-password" />
          <label htmlFor="confirm-password" style={{ fontSize: 14, fontWeight: 600 }}>
            Type it again
          </label>
          <input id="confirm-password" className="field" type="password" name="confirm" required minLength={PASSWORD_MIN} maxLength={200} autoComplete="new-password" />
          <button className="btn btn-navy">Save password</button>
        </form>
      </div>
    </SiteShell>
  );
}
