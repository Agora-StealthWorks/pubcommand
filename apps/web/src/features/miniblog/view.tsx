import type { ReactNode } from "react";
import { complianceLines } from "../../../../../modules/miniblog/sms";
import { formatZonedDate } from "../../../../../modules/miniblog/time";
import type { Branding, PostRow, SiteRow } from "./data";
import { sanitizeRich } from "./sanitize";

/** Typography for sanitized rich text on public pages. */
export const RICH =
  "[&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:pl-3 [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-xl [&_h2]:font-bold [&_h3]:mb-2 [&_h3]:mt-3 [&_h3]:text-lg [&_h3]:font-bold [&_img]:h-auto [&_img]:max-w-full [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0";

/** The public page frame: header with the logo, content, SMS compliance footer. */
export function BlogShell({ site, branding, base, children, preview }: { site: SiteRow; branding: Branding; base: string; children: ReactNode; preview?: boolean }) {
  return (
    <div className="flex min-h-screen flex-col bg-[#f5f6f8] text-[#1f2937]">
      {preview ? <div className="bg-[#fef0c7] px-4 py-2 text-center text-xs font-semibold text-[#93370d]">Preview. This Mini-Blog is {site.status === "live" ? "live" : "not live yet"}; visitors cannot see drafts or scheduled posts.</div> : null}
      <header style={{ background: branding.headerBg, color: branding.headerText }}>
        <div className="mx-auto flex max-w-2xl items-center justify-center px-4 py-3.5">
          <a href={base || "/"} className="inline-flex max-w-full items-center" aria-label={site.name}>
            {branding.logoSrc ? (
              <img src={branding.logoSrc} alt={site.name} style={{ maxHeight: branding.logoHeight, maxWidth: "100%", width: "auto" }} />
            ) : (
              <span className="truncate text-lg font-bold tracking-tight">{site.name}</span>
            )}
          </a>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">{children}</main>
      <footer className="border-t border-black/10 bg-white px-4 py-6 text-center text-xs text-[#475467]">
        <div className="mx-auto max-w-2xl space-y-1.5">
          {complianceLines(site).map((line) => (
            <p key={line}>{line}</p>
          ))}
          <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 pt-1">
            <span>© {new Date().getFullYear()} {branding.companyName}</span>
            {branding.privacyUrl ? (
              <a href={branding.privacyUrl} className="underline" target="_blank" rel="noopener noreferrer">
                Privacy policy
              </a>
            ) : null}
            {branding.termsUrl ? (
              <a href={branding.termsUrl} className="underline" target="_blank" rel="noopener noreferrer">
                Terms
              </a>
            ) : null}
          </p>
        </div>
      </footer>
    </div>
  );
}

export function SubscribeCard({ site, branding, base }: { site: SiteRow; branding: Branding; base: string }) {
  return (
    <aside className="rounded-xl border border-black/10 bg-white p-5 text-center">
      <p className="text-base font-bold">Get {site.programName || site.name} by text</p>
      {site.tagline ? <p className="mt-1 text-sm text-[#475467]">{site.tagline}</p> : null}
      <a href={`${base}/subscribe`} className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg px-5 text-sm font-bold" style={{ background: branding.accentColor, color: branding.accentText }}>
        Subscribe by text
      </a>
    </aside>
  );
}

export function PostBody({ post, branding, timeZone }: { post: PostRow; branding: Branding; timeZone: string }) {
  const html = sanitizeRich(post.bodyHtml);
  return (
    <article className="rounded-xl border border-black/10 bg-white p-5 sm:p-7">
      <p className="text-xs font-semibold uppercase tracking-wider text-[#475467]">{formatZonedDate(post.publishAt, timeZone)}</p>
      <h1 className="mt-1 text-2xl font-extrabold tracking-tight [overflow-wrap:anywhere] sm:text-3xl">{post.title}</h1>
      {html ? <div className={`${RICH} mt-4 text-base leading-relaxed [overflow-wrap:anywhere]`} dangerouslySetInnerHTML={{ __html: html }} /> : null}
      {post.actionToTake ? (
        <div className="mt-6 rounded-lg border-2 p-4" style={{ borderColor: branding.accentColor }}>
          <p className="text-xs font-bold uppercase tracking-wider" style={{ color: branding.accentColor }}>
            Action to take
          </p>
          <p className="mt-1 whitespace-pre-line text-base font-semibold [overflow-wrap:anywhere]">{post.actionToTake}</p>
        </div>
      ) : null}
      {post.buttonText && post.buttonUrl ? (
        <div className="mt-6 text-center">
          <a href={post.buttonUrl} rel="noopener" className="inline-flex min-h-12 max-w-full items-center justify-center rounded-lg px-6 text-base font-bold" style={{ background: branding.accentColor, color: branding.accentText }}>
            {post.buttonText}
          </a>
        </div>
      ) : null}
    </article>
  );
}
