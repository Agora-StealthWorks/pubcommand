import type { CSSProperties, ReactNode } from "react";
import { contrastText, safeColor } from "../../../../../modules/miniblog/site";
import { FONT_STACKS, themeById, type MiniBlogTheme } from "../../../../../modules/miniblog/themes";

/**
 * The Mini-Blog page parts, shared by the public pages (server) and the admin
 * live previews (client). Presentation only: callers pass HTML that is already
 * sanitized. The look comes from CSS variables set by <LookStyle>, so a theme or
 * color change in the editor shows instantly.
 */

export type Look = {
  theme: MiniBlogTheme;
  headerBg: string;
  headerText: string;
  /** Links, the T-Letter footer's "View Archives", the classic action-box border. */
  accentColor: string;
  accentText: string;
  /** Buttons (action button, subscribe buttons). */
  buttonColor: string;
  buttonText: string;
  /** The page around the content box, and readable small text on it. */
  pageBg: string;
  pageMuted: string;
  /** Links that sit on the page itself ("View Archives", the folded archive): the link color when it reads on the page. */
  pageLink: string;
  titleColor: string;
  logoHeight: number;
};

/** WCAG contrast ratio of two #rrggbb colors. */
function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x! + 0.05) / (y! + 0.05);
}

export type LookSettings = { theme: string; headerBg: string; accentColor: string; logoHeight: number; pageBg?: string | null; buttonColor?: string | null };

/**
 * The look of a Mini-Blog: its theme, with its own header, link, button and page
 * colors and logo size on top. An empty page color keeps the theme's; an empty
 * button color uses the link color.
 */
export function lookFrom(site: LookSettings): Look {
  const theme = themeById(site.theme);
  const headerBg = safeColor(site.headerBg, theme.headerBg);
  const accentColor = safeColor(site.accentColor, theme.accent);
  const buttonColor = safeColor(site.buttonColor, accentColor);
  const pageBg = safeColor(site.pageBg, theme.pageBg);
  // Footer and legal text sit on the page: keep them readable on whatever color it is.
  const pageMuted = pageBg.toLowerCase() === theme.pageBg.toLowerCase() ? theme.muted : contrastText(pageBg) === "#ffffff" ? "rgba(255,255,255,0.78)" : "rgba(17,24,39,0.7)";
  const headerText = contrastText(headerBg);
  // The T-Letter title takes the header color, unless that color is too light to read on a card.
  const titleColor = theme.title === "header" ? (headerText === "#ffffff" ? headerBg : theme.ink) : theme.title;
  const pageLink = contrastRatio(accentColor, pageBg) >= 3 ? accentColor : contrastText(pageBg) === "#ffffff" ? "#ffffff" : "#111827";
  return { theme, headerBg, headerText, accentColor, accentText: contrastText(accentColor), buttonColor, buttonText: contrastText(buttonColor), pageBg, pageMuted, pageLink, titleColor, logoHeight: Math.max(16, Math.min(120, Math.round(site.logoHeight))) };
}

/** Typography for sanitized rich text (the T-Letter body rules). */
const CSS = `
.mb-root{background:var(--mb-page);color:var(--mb-ink);font-family:var(--mb-font);min-height:100%;display:flex;flex-direction:column}
.mb-header{background:var(--mb-header);color:var(--mb-header-ink);padding:14px 18px;display:flex;justify-content:center;align-items:center}
.mb-header a{display:inline-flex;align-items:center;max-width:100%;color:inherit;text-decoration:none}
.mb-header img{max-width:100%;width:auto;display:block}
.mb-header .mb-name{font-weight:700;font-size:18px;letter-spacing:-.01em;overflow-wrap:anywhere;text-align:center}
.mb-header.mb-light{border-bottom:1px solid var(--mb-line)}
.mb-wrap{width:100%;max-width:680px;margin:0 auto;padding:18px 16px 40px;flex:1}
.mb-stack>*+*{margin-top:18px}
.mb-textad{display:block;background:var(--mb-ad);border:1px solid var(--mb-line);border-radius:10px;padding:12px 14px;font-size:13px;line-height:1.45;text-align:center;color:var(--mb-muted);white-space:pre-line;overflow-wrap:anywhere}
a.mb-textad{color:var(--mb-accent);text-decoration:underline}
.mb-adcode{text-align:center;overflow:hidden}
.mb-adph{border:1px dashed var(--mb-muted);border-radius:10px;padding:14px;text-align:center;font-size:12px;color:var(--mb-muted)}
.mb-card{background:var(--mb-card);border:1px solid var(--mb-card-line);border-radius:var(--mb-radius);padding:24px 20px 20px}
.mb-date{color:var(--mb-muted);font-size:13px;margin:0 0 6px}
.mb-title{color:var(--mb-title);font-size:24px;line-height:1.25;font-weight:700;margin:0 0 16px;overflow-wrap:anywhere}
.mb-body{color:var(--mb-ink);font-size:16.5px;line-height:1.6;overflow-wrap:anywhere}
.mb-body p{margin:0 0 1em}.mb-body>*:last-child{margin-bottom:0}
.mb-body a{color:var(--mb-accent);text-decoration:underline}
.mb-body h2{font-size:1.3rem;font-weight:700;margin:1.1em 0 .5em}.mb-body h3{font-size:1.12rem;font-weight:700;margin:1em 0 .45em}
.mb-body ul{list-style:disc;padding-left:1.3rem;margin:0 0 1em}.mb-body ol{list-style:decimal;padding-left:1.3rem;margin:0 0 1em}.mb-body li{margin:.25em 0}
.mb-body blockquote{border-left:4px solid var(--mb-line);padding-left:12px;margin:0 0 1em;color:var(--mb-muted)}
.mb-body img{border-radius:8px;height:auto;max-width:100%}
.mb-body table{border-collapse:collapse;width:100%;font-size:15px}.mb-body th,.mb-body td{border:1px solid var(--mb-line);padding:8px 10px;text-align:left}
.mb-inline-ad{margin:1.2em 0}
.mb-action{margin-top:24px;border-radius:8px;padding:20px}
.mb-action.tletter{background:var(--mb-ad)}
.mb-action.boxed{border:2px solid var(--mb-accent)}
.mb-action-line{font-size:21px;line-height:1.45;margin:0;overflow-wrap:anywhere}
.mb-action.tletter .mb-action-text{color:var(--mb-action);font-weight:700;white-space:pre-line}
.mb-action.boxed .mb-action-label{display:block;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--mb-accent)}
.mb-action.boxed .mb-action-line{font-size:17px;font-weight:600}
.mb-action.boxed .mb-action-text{white-space:pre-line}
.mb-action-secondary{color:var(--mb-muted);font-size:12.5px;font-style:italic;line-height:1.5;margin:10px 0 0}
.mb-btn{display:block;width:fit-content;max-width:100%;background:var(--mb-button);color:var(--mb-button-ink);text-decoration:none;font-weight:700;font-size:15px;padding:12px 22px;border-radius:8px;margin:16px auto 0;text-align:center;overflow-wrap:anywhere}
.mb-sub{background:var(--mb-card);border:1px solid var(--mb-card-line);border-radius:var(--mb-radius);padding:20px;text-align:center}
.mb-sub p{margin:0}.mb-sub .mb-sub-title{font-weight:700;font-size:16px}.mb-sub .mb-sub-tag{color:var(--mb-muted);font-size:14px;margin-top:4px}
.mb-sub a{display:inline-flex;min-height:44px;align-items:center;justify-content:center;border-radius:8px;padding:0 20px;margin-top:14px;font-weight:700;font-size:14px;background:var(--mb-button);color:var(--mb-button-ink);text-decoration:none}
.mb-foot{display:grid;grid-template-columns:1fr 1fr 1fr;align-items:start;column-gap:10px;border-top:1px solid var(--mb-line);padding-top:14px;font-size:11px;line-height:1.35;color:var(--mb-page-muted)}
.mb-foot>span:nth-child(1){text-align:left;overflow-wrap:anywhere}.mb-foot>span:nth-child(2){text-align:center;overflow-wrap:anywhere}.mb-foot>span:nth-child(3){text-align:right;color:var(--mb-page-link);font-weight:700;overflow-wrap:anywhere}
.mb-arch summary{cursor:pointer;list-style:none}.mb-arch summary::-webkit-details-marker{display:none}
.mb-arch ul{list-style:none;padding:0;margin:12px 0 0}.mb-arch li{border-bottom:1px solid var(--mb-line)}
.mb-arch li a{display:block;padding:8px 0;color:var(--mb-page-link);text-decoration:none;font-size:15px;overflow-wrap:anywhere}
.mb-arch-date{display:block;color:var(--mb-page-muted);font-size:12px}.mb-archive .mb-arch-date{color:var(--mb-muted)}
.mb-archive{background:var(--mb-card);border:1px solid var(--mb-card-line);border-radius:var(--mb-radius)}
.mb-archive h2{margin:0;border-bottom:1px solid var(--mb-line);padding:12px 20px;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--mb-muted)}
.mb-archive ul{list-style:none;margin:0;padding:0}.mb-archive li{border-bottom:1px solid var(--mb-line)}.mb-archive li:last-child{border-bottom:0}
.mb-archive a{display:block;padding:12px 20px;color:inherit;text-decoration:none}
.mb-archive .mb-ex{display:block;color:var(--mb-muted);font-size:14px}
.mb-legal{margin-top:14px;font-size:11px;line-height:1.5;color:var(--mb-page-muted);text-align:center}
.mb-legal p{margin:2px 0}.mb-legal a{color:inherit;text-decoration:underline}.mb-legal a+a{margin-left:12px}
.mb-classic-foot{border-top:1px solid var(--mb-line);background:var(--mb-card);padding:22px 16px;text-align:center;font-size:12px;color:var(--mb-muted)}
.mb-classic-foot p{margin:3px 0}.mb-classic-foot a{color:inherit;text-decoration:underline;margin:0 6px}
`;

/** CSS variables for one look, set on the page root. */
export function lookVars(look: Look): CSSProperties {
  const t = look.theme;
  return {
    "--mb-page": look.pageBg,
    "--mb-page-muted": look.pageMuted,
    "--mb-page-link": look.pageLink,
    "--mb-card": t.cardBg,
    "--mb-card-line": t.cardBorder,
    "--mb-line": t.line,
    "--mb-ink": t.ink,
    "--mb-muted": t.muted,
    "--mb-title": look.titleColor,
    "--mb-font": FONT_STACKS[t.font],
    "--mb-radius": `${t.radius}px`,
    "--mb-ad": t.adBg,
    "--mb-action": t.actionInk,
    "--mb-header": look.headerBg,
    "--mb-header-ink": look.headerText,
    "--mb-accent": look.accentColor,
    "--mb-accent-ink": look.accentText,
    "--mb-button": look.buttonColor,
    "--mb-button-ink": look.buttonText,
  } as CSSProperties;
}

export function LookStyle() {
  return <style dangerouslySetInnerHTML={{ __html: CSS }} />;
}

/** The page frame: CSS variables on the root, then children. */
export function LookRoot({ look, children, className = "" }: { look: Look; children: ReactNode; className?: string }) {
  return (
    <div className={`mb-root ${className}`} style={lookVars(look)}>
      <LookStyle />
      {children}
    </div>
  );
}

/** Header bar with the logo centered (the brand name only when there is no logo). */
export function BlogHeader({ look, logoSrc, name, href }: { look: Look; logoSrc: string | null; name: string; href: string | null }) {
  const inner = logoSrc ? (
    <img src={logoSrc} alt={name} style={{ maxHeight: look.logoHeight }} />
  ) : (
    <span className="mb-name">{name}</span>
  );
  // A header in the page color (Minimal) gets a hairline so it still reads as a header.
  const flush = look.headerBg.toLowerCase() === look.pageBg.toLowerCase();
  return (
    <header className={`mb-header ${flush ? "mb-light" : ""}`}>
      {href ? (
        <a href={href} aria-label={name}>
          {inner}
        </a>
      ) : (
        inner
      )}
    </header>
  );
}

export function TextAd({ text, href }: { text: string; href: string | null }) {
  return href ? (
    <a className="mb-textad" href={href} rel="nofollow sponsored noopener">
      {text}
    </a>
  ) : (
    <div className="mb-textad">{text}</div>
  );
}

/** An ad network snippet, live on public pages. */
export function AdCodeSlot({ html, label }: { html: string; label: string }) {
  return <div className="mb-adcode" data-ad-zone={label} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** What the admin preview shows instead of running an ad network's script. */
export function AdPlaceholder({ label }: { label: string }) {
  return <div className="mb-adph">Ad: {label}</div>;
}

export type ArticleProps = {
  look: Look;
  date: string;
  title: string;
  /** Sanitized body HTML up to the [content ad] shortcode (all of it when there is none). */
  bodyBefore: string;
  /** Sanitized body HTML after the shortcode; null = no shortcode. */
  bodyAfter: string | null;
  contentAd: ReactNode;
  actionToTake: string | null;
  actionSecondary: string | null;
  button: { text: string; href: string } | null;
};

export function PostArticle({ look, date, title, bodyBefore, bodyAfter, contentAd, actionToTake, actionSecondary, button }: ArticleProps) {
  const style = look.theme.action;
  return (
    <article className="mb-card">
      <p className="mb-date">{date}</p>
      {title ? <h1 className="mb-title">{title}</h1> : null}
      {bodyBefore ? <div className="mb-body rte-content" dangerouslySetInnerHTML={{ __html: bodyBefore }} /> : null}
      {bodyAfter !== null && contentAd ? <div className="mb-inline-ad">{contentAd}</div> : null}
      {bodyAfter ? <div className="mb-body rte-content" dangerouslySetInnerHTML={{ __html: bodyAfter }} /> : null}
      {actionToTake?.trim() ? (
        <div className={`mb-action ${style}`}>
          <p className="mb-action-line">
            {style === "tletter" ? <strong>Action to take: </strong> : <span className="mb-action-label">Action to take</span>}
            <span className="mb-action-text">{actionToTake}</span>
          </p>
          {actionSecondary?.trim() ? <p className="mb-action-secondary">{actionSecondary}</p> : null}
          {button ? (
            <a className="mb-btn" href={button.href} rel="noopener">
              {button.text}
            </a>
          ) : null}
        </div>
      ) : button ? (
        <a className="mb-btn" href={button.href} rel="noopener">
          {button.text}
        </a>
      ) : null}
    </article>
  );
}

export type ArchiveLink = { href: string; title: string; date: string; excerpt?: string };

/**
 * The T-Letter footer: one row (name · © company · View Archives) that opens the
 * archive under it, with no JavaScript (a native <details>).
 */
export function TLetterFooter({ siteName, companyName, archives }: { siteName: string; companyName: string; archives: ArchiveLink[] }) {
  const year = new Date().getFullYear();
  if (!archives.length) {
    return (
      <div className="mb-foot">
        <span>{siteName}</span>
        <span>
          © {year} {companyName}
        </span>
        <span />
      </div>
    );
  }
  return (
    <details className="mb-arch">
      <summary className="mb-foot">
        <span>{siteName}</span>
        <span>
          © {year} {companyName}
        </span>
        <span>View Archives</span>
      </summary>
      <ul>
        {archives.map((item) => (
          <li key={item.href}>
            <a href={item.href}>
              {item.title}
              <span className="mb-arch-date">{item.date}</span>
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** The classic archive card (older posts with excerpts). */
export function ArchiveCard({ archives }: { archives: ArchiveLink[] }) {
  if (!archives.length) return null;
  return (
    <section className="mb-archive">
      <h2>Archive</h2>
      <ul>
        {archives.map((item) => (
          <li key={item.href}>
            <a href={item.href}>
              <span className="mb-arch-date">{item.date}</span>
              <strong style={{ display: "block", overflowWrap: "anywhere" }}>{item.title}</strong>
              {item.excerpt ? <span className="mb-ex">{item.excerpt}</span> : null}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SubscribeBox({ title, tagline, href, cta }: { title: string; tagline: string; href: string; cta: string }) {
  return (
    <aside className="mb-sub">
      <p className="mb-sub-title">{title}</p>
      {tagline ? <p className="mb-sub-tag">{tagline}</p> : null}
      <a href={href}>{cta}</a>
    </aside>
  );
}
