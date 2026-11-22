import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PASSWORD_MIN, SET_PASSWORD_PATH, safeReturnPath } from "../../../../../../../../../../modules/websites/content";
import { loadSite, loadViewer } from "@/features/websites/public";
import { SiteShell } from "@/features/websites/site-view";

type Params = Promise<{ slug: string; siteSlug: string }>;
type Query = Promise<{ next?: string; sent?: string; error?: string; dev?: string; forgot?: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, siteSlug } = await params;
  const loaded = await loadSite(slug, siteSlug);
  return { title: { absolute: loaded ? `Member login | ${loaded.site.name}` : "Not found" }, robots: { index: false } };
}

const LOGIN_ERRORS: Record<string, string> = {
  invalid: "That email and password do not match. Try again, or set a new password below.",
  limited: "Too many tries. Wait 15 minutes, or set a new password below.",
};

const LINK_ERRORS: Record<string, string> = {
  expired: "That link has expired or was already used. Request a new one.",
  email: "Please enter a valid email address.",
};

const link = { color: "var(--dgold)", fontWeight: 600 } as const;

/** Member login: email + password. The emailed link only sets or resets a password. */
export default async function SignInPage({ params, searchParams }: { params: Params; searchParams: Query }) {
  const { slug, siteSlug } = await params;
  const query = await searchParams;
  const loaded = await loadSite(slug, siteSlug);
  if (!loaded) notFound();
  const { member, pending } = await loadViewer(loaded.organizationId, loaded.site.id);
  const next = safeReturnPath(query.next, `${loaded.base}/my`);
  const forgot = query.forgot === "1";
  if (member && !forgot && !query.sent) redirect(next);
  const { base, site } = loaded;
  const here = `${base}/sign-in`;
  const nextQuery = next === `${base}/my` ? "" : `&next=${encodeURIComponent(next)}`;
  return (
    <SiteShell loaded={loaded} member={null}>
      <div className="auth">
        <span className="label">Members</span>
        {query.sent ? (
          <>
            <h1>Check your email</h1>
            <p>If that address has an account with {site.name}, we just sent it a link to set your password. It works once and expires in 30 minutes.</p>
            {query.dev ? (
              <p style={{ background: "#fff4d6", padding: 10, fontSize: 13, wordBreak: "break-all" }}>
                Local testing only:{" "}
                <a href={query.dev} id="dev-link" style={link}>
                  open the link
                </a>
              </p>
            ) : null}
            <p>
              <a href={here} style={link}>
                Back to member login
              </a>
            </p>
          </>
        ) : forgot ? (
          <>
            <h1>Set your password</h1>
            <p>Forgot your password, or never set one? Enter the email you subscribed with and we&apos;ll email you a link to set it.</p>
            {query.error && LINK_ERRORS[query.error] ? <p className="note-err">{LINK_ERRORS[query.error]}</p> : null}
            <form method="post" action={`${base}/sign-in/link`}>
              <input type="hidden" name="next" value={next} />
              <label className="sr-only" htmlFor="link-email">
                Email address
              </label>
              <input id="link-email" className="field" type="email" name="email" required autoComplete="email" placeholder="you@example.com" />
              <button className="btn btn-navy">Email me a link to set my password</button>
            </form>
            <p style={{ fontSize: 14, marginTop: 18 }}>
              Remembered it?{" "}
              <a href={`${here}${nextQuery ? `?${nextQuery.slice(1)}` : ""}`} style={link}>
                Log in
              </a>
            </p>
          </>
        ) : (
          <>
            <h1>Member login</h1>
            {pending ? (
              <p className="note-err">
                You have not set a password yet.{" "}
                <a href={`${base}${SET_PASSWORD_PATH}?next=${encodeURIComponent(next)}`} style={link}>
                  Set it now
                </a>
              </p>
            ) : null}
            {query.error && LOGIN_ERRORS[query.error] ? <p className="note-err">{LOGIN_ERRORS[query.error]}</p> : null}
            <form method="post" action={`${base}/sign-in/submit`}>
              <input type="hidden" name="next" value={next} />
              <label htmlFor="member-email" style={{ fontSize: 14, fontWeight: 600 }}>
                Email
              </label>
              <input id="member-email" className="field" type="email" name="email" required autoComplete="email" placeholder="you@example.com" />
              <label htmlFor="member-password" style={{ fontSize: 14, fontWeight: 600 }}>
                Password
              </label>
              <input id="member-password" className="field" type="password" name="password" required autoComplete="current-password" minLength={1} maxLength={200} />
              <button className="btn btn-navy">Log in</button>
            </form>
            <p style={{ fontSize: 14, marginTop: 18 }}>
              <a href={`${here}?forgot=1${nextQuery}`} style={link}>
                Forgot your password, or never set one?
              </a>
            </p>
            <p style={{ fontSize: 14 }}>
              Not a member yet?{" "}
              <a href={`${base}/publications`} style={link}>
                See our publications
              </a>
            </p>
          </>
        )}
        <p style={{ fontSize: 12, marginTop: 8 }}>Passwords are at least {PASSWORD_MIN} characters.</p>
      </div>
    </SiteShell>
  );
}
