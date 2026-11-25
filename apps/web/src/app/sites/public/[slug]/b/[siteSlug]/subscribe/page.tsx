import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { siteBranding } from "@/features/miniblog/data";
import { loadPublicSite, publicBase, publicSiteMatches } from "@/features/miniblog/public";
import { sanitizeRich } from "@/features/miniblog/sanitize";
import { BlogShell, RICH } from "@/features/miniblog/view";
import { emailComplianceLines, emailConsentText } from "../../../../../../../../../../modules/miniblog/sms";
import { subscribeKind } from "../../../../../../../../../../modules/miniblog/mediums";

type Params = Promise<{ slug: string; siteSlug: string }>;
type Search = Promise<{ preview?: string; done?: string; error?: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, siteSlug } = await params;
  const loaded = (await publicSiteMatches(slug)) ? await loadPublicSite(slug, siteSlug) : null;
  return { title: { absolute: loaded ? `Subscribe · ${loaded.site.name}` : "Not found" } };
}

/**
 * The email sign-up page: an email address and a consent checkbox; the consent
 * text shown is stored with the opt-in. Every other medium (SMS, Push
 * Notification, custom) 404s here: Mini-Blogs have no SMS sign-up.
 */
export default async function SubscribePage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { slug, siteSlug } = await params;
  const query = await searchParams;
  if (!(await publicSiteMatches(slug))) notFound();
  const loaded = await loadPublicSite(slug, siteSlug, query);
  if (!loaded) notFound();
  const { site } = loaded;
  if (subscribeKind(site.medium) !== "email") notFound();
  const base = await publicBase(siteSlug);
  const branding = siteBranding(site, loaded.brandName, base);
  const consent = emailConsentText(site);
  const intro = sanitizeRich(site.introHtml);
  const lines = emailComplianceLines(site);
  return (
    <BlogShell site={site} branding={branding} base={base} preview={loaded.preview} pixel={!query.done && !query.error ? `${base}/px` : null}>
      <section className="mb-card">
        <h1 className="mb-title">
          Get {site.programName || site.name} by email
        </h1>
        {site.tagline ? <p className="mb-date" style={{ fontSize: 15 }}>{site.tagline}</p> : null}
        {intro ? <div className={`${RICH} rte-content mb-body mt-4`} dangerouslySetInnerHTML={{ __html: intro }} /> : null}
        {query.done === "1" ? (
          <div className="mt-6 rounded-lg border border-[#abefc6] bg-[#ecfdf3] p-4 text-[#067647]" role="status">
            <p className="font-bold">You're subscribed.</p>
            <p className="mt-1 text-sm">Thanks for signing up. Every email has an unsubscribe link.</p>
          </div>
        ) : (
          <form action={`${base}/subscribe/submit`} method="post" className="mt-6 space-y-4">
            {query.error ? (
              <p className="rounded-md border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm text-[#912018]" role="alert">
                {query.error}
              </p>
            ) : null}
            <input type="hidden" name="back" value={`${base}/subscribe`} />
            <input type="hidden" name="consentShown" value={consent} />
            <div aria-hidden="true" className="hidden">
              <label>
                Leave empty <input name="website" tabIndex={-1} autoComplete="off" />
              </label>
            </div>
              <div>
                <label htmlFor="email" className="text-sm font-semibold">
                  Email address
                </label>
                <input id="email" name="email" type="email" inputMode="email" autoComplete="email" required placeholder="you@example.com" className="mt-1 h-12 w-full rounded-lg border border-black/15 bg-white px-3 text-base text-[#111827]" />
              </div>
            <label className="flex items-start gap-3 text-sm leading-snug">
              <input type="checkbox" name="consent" value="yes" required className="mt-0.5 h-5 w-5 shrink-0" />
              <span className="[overflow-wrap:anywhere]">{consent}</span>
            </label>
            <button type="submit" className="h-12 w-full rounded-lg text-base font-bold" style={{ background: branding.buttonColor, color: branding.buttonText }}>
              Subscribe
            </button>
            <div className="space-y-1 text-xs" style={{ color: "var(--mb-muted)" }}>
              {lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          </form>
        )}
        <p className="mt-6 text-center text-sm">
          <a href={base || "/"} className="font-semibold underline">
            ← Read the latest posts
          </a>
        </p>
      </section>
    </BlogShell>
  );
}
