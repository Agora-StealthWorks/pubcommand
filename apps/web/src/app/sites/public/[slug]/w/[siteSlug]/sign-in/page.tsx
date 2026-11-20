import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { safeReturnPath } from "../../../../../../../../../../modules/websites/content";
import { loadSite, loadViewer } from "@/features/websites/public";
import { SiteShell } from "@/features/websites/site-view";

type Params = Promise<{ slug: string; siteSlug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, siteSlug } = await params;
  const loaded = await loadSite(slug, siteSlug);
  return { title: { absolute: loaded ? `Member login | ${loaded.site.name}` : "Not found" }, robots: { index: false } };
}

export default async function SignInPage({ params, searchParams }: { params: Params; searchParams: Promise<{ next?: string; sent?: string; error?: string; dev?: string }> }) {
  const { slug, siteSlug } = await params;
  const query = await searchParams;
  const loaded = await loadSite(slug, siteSlug);
  if (!loaded) notFound();
  const { member } = await loadViewer(loaded.organizationId, loaded.site.id);
  const next = safeReturnPath(query.next, `${loaded.base}/my`);
  if (member) redirect(next);
  return (
    <SiteShell loaded={loaded} member={null}>
      <div className="auth">
        <span className="label">Members</span>
        <h1>{query.sent ? "Check your email" : "Member login"}</h1>
        {query.sent ? (
          <>
            <p>If that address has an account with {loaded.site.name}, we just sent it a sign-in link. It works once and expires in 30 minutes.</p>
            {query.dev ? (
              <p style={{ background: "#fff4d6", padding: 10, fontSize: 13, wordBreak: "break-all" }}>
                Local testing only: <a href={query.dev} style={{ color: "var(--dgold)", fontWeight: 600 }}>open the sign-in link</a>
              </p>
            ) : null}
            <p>
              <a href={`${loaded.base}/sign-in`} style={{ color: "var(--dgold)", fontWeight: 600 }}>Use a different email</a>
            </p>
          </>
        ) : (
          <>
            <p>Enter the email you subscribed with. We&apos;ll email you a link to sign in. No password needed.</p>
            {query.error === "expired" ? <p className="note-err">That link has expired or was already used. Request a new one.</p> : null}
            {query.error === "email" ? <p className="note-err">Please enter a valid email address.</p> : null}
            <form method="post" action={`${loaded.base}/sign-in/submit`}>
              <input type="hidden" name="next" value={next} />
              <input className="field" type="email" name="email" required autoComplete="email" placeholder="you@example.com" aria-label="Email address" />
              <button className="btn btn-navy">Email me a sign-in link</button>
            </form>
            <p style={{ fontSize: 14, marginTop: 18 }}>
              Not a member yet? <a href={`${loaded.base}/newsletters`} style={{ color: "var(--dgold)", fontWeight: 600 }}>Join free</a>
            </p>
          </>
        )}
      </div>
    </SiteShell>
  );
}
