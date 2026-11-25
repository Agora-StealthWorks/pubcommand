import type { ReactNode } from "react";
import { RichContentStyles } from "@/components/rich-text-editor/content-css";
import { parseAdCodes, resolveAd, splitAtContentAd, stripContentAd, type ResolvedAd } from "../../../../../modules/miniblog/ads";
import { rewriteLinks } from "../../../../../modules/miniblog/links";
import { subscribeKind } from "../../../../../modules/miniblog/mediums";
import { complianceLines, emailComplianceLines } from "../../../../../modules/miniblog/sms";
import { formatZonedDate } from "../../../../../modules/miniblog/time";
import { AdCodeSlot, ArchiveCard, BlogHeader, LookRoot, PostArticle, SubscribeBox, TLetterFooter, TextAd, type ArchiveLink } from "./article";
import type { Branding, PostRow, SiteRow } from "./data";
import { sanitizeRich } from "./sanitize";

/** Typography for sanitized rich text on the subscribe page intro. */
export const RICH =
  "[&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:pl-3 [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-xl [&_h2]:font-bold [&_h3]:mb-2 [&_h3]:mt-3 [&_h3]:text-lg [&_h3]:font-bold [&_img]:h-auto [&_img]:max-w-full [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0";

/** The legal lines for the Mini-Blog's medium (none for mediums without a subscribe form). */
function legalLines(site: SiteRow): string[] {
  const kind = subscribeKind(site.medium);
  return kind === "sms" ? complianceLines(site) : kind === "email" ? emailComplianceLines(site) : [];
}

/**
 * The public page frame: centered logo header, content and the footer for the
 * theme (T-Letter row with the archive folded under it, or the classic footer).
 * `archives` only feeds the T-Letter footer; classic pages show <ArchiveCard> in the content.
 */
export function BlogShell({ site, branding, base, children, preview, archives = [], pixel }: { site: SiteRow; branding: Branding; base: string; children: ReactNode; preview?: boolean; archives?: ArchiveLink[]; pixel?: string | null }) {
  const lines = legalLines(site);
  const year = new Date().getFullYear();
  const links = (
    <>
      {branding.privacyUrl ? (
        <a href={branding.privacyUrl} target="_blank" rel="noopener noreferrer">
          Privacy policy
        </a>
      ) : null}
      {branding.termsUrl ? (
        <a href={branding.termsUrl} target="_blank" rel="noopener noreferrer">
          Terms
        </a>
      ) : null}
    </>
  );
  return (
    <LookRoot look={branding} className="min-h-screen">
      <RichContentStyles />
      {preview ? <div className="bg-[#fef0c7] px-4 py-2 text-center text-xs font-semibold text-[#93370d]">Preview. This Mini-Blog is {site.status === "live" ? "live" : "not live yet"}; visitors cannot see drafts or scheduled posts.</div> : null}
      <BlogHeader look={branding} logoSrc={branding.logoSrc} name={site.name} href={base || "/"} />
      <main className="mb-wrap">
        <div className="mb-stack">{children}</div>
        {branding.theme.footer === "tletter" ? (
          <div style={{ marginTop: 26 }}>
            <TLetterFooter siteName={site.name} companyName={branding.companyName} archives={site.archivesEnabled ? archives : []} />
            {lines.length || branding.privacyUrl || branding.termsUrl ? (
              <div className="mb-legal">
                {lines.map((line) => (
                  <p key={line}>{line}</p>
                ))}
                {branding.privacyUrl || branding.termsUrl ? <p>{links}</p> : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </main>
      {branding.theme.footer === "classic" ? (
        <footer className="mb-classic-foot">
          {lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
          <p>
            <span>
              © {year} {branding.companyName}
            </span>
            {links}
          </p>
        </footer>
      ) : null}
      {/* First-party view pixel: counts views and unique visitors; previews never count. */}
      {pixel && !preview ? (
        <img src={pixel} alt="" width={1} height={1} style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }} />
      ) : null}
    </LookRoot>
  );
}

/** The subscribe button card, per medium. Mediums without a form (Push, custom) show nothing. */
export function SubscribeCard({ site, base }: { site: SiteRow; branding?: Branding; base: string }) {
  const kind = subscribeKind(site.medium);
  if (kind === "none") return null;
  const program = site.programName || site.name;
  return <SubscribeBox title={kind === "sms" ? `Get ${program} by text` : `Get ${program} by email`} tagline={site.tagline} href={`${base}/subscribe`} cta={kind === "sms" ? "Subscribe by text" : "Subscribe by email"} />;
}

function AdZone({ ad, hrefs, label }: { ad: ResolvedAd; hrefs?: Map<string, string>; label: string }) {
  if (!ad) return null;
  if (ad.kind === "text") return <TextAd text={ad.text} href={ad.link ? hrefs?.get(ad.link) ?? ad.link : null} />;
  return <AdCodeSlot html={ad.code.code} label={`${label}:${ad.code.id}`} />;
}

/** The top ad for a post (above its card). */
export function TopAd({ post, site, hrefs }: { post: PostRow; site: SiteRow; hrefs?: Map<string, string> }) {
  return <AdZone ad={resolveAd(post.topAd, post.topAdText, post.topAdLink, parseAdCodes(site.adCodes))} hrefs={hrefs} label="top" />;
}

/** A post. `hrefs` (stored URL → tracked /go/ path) turns its links into counted links. */
export function PostBody({ post, site, branding, timeZone, hrefs }: { post: PostRow; site: SiteRow; branding: Branding; timeZone: string; hrefs?: Map<string, string> }) {
  const clean = sanitizeRich(post.bodyHtml);
  const html = hrefs?.size ? rewriteLinks(clean, (url) => hrefs.get(url) ?? null) : clean;
  const contentAd = resolveAd(post.contentAd, post.contentAdText, post.contentAdLink, parseAdCodes(site.adCodes));
  const { before, after } = contentAd ? splitAtContentAd(html) : { before: stripContentAd(html), after: null };
  const buttonHref = post.buttonUrl ? hrefs?.get(post.buttonUrl.trim()) ?? post.buttonUrl : null;
  return (
    <PostArticle
      look={branding}
      date={formatZonedDate(post.publishAt, timeZone)}
      title={post.title}
      bodyBefore={before}
      bodyAfter={after}
      contentAd={<AdZone ad={contentAd} hrefs={hrefs} label="content" />}
      actionToTake={post.actionToTake}
      actionSecondary={post.actionSecondary}
      button={post.buttonText && buttonHref ? { text: post.buttonText, href: buttonHref } : null}
    />
  );
}

export { ArchiveCard };
