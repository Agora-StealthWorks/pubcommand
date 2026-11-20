import type { CSSProperties, ReactNode } from "react";
import type { Publication } from "@/features/pubsetup/read";
import { contentTypeLabel, menuHref } from "../../../../../modules/websites/content";
import type { CardPost, LoadedSite } from "./public";
import type { SignedInMember } from "./members";
import { formatPrice, tickerQuotes } from "./ticker";

/** Theme colors and logo size as CSS variables on the .ws root. */
export function themeStyle(loaded: LoadedSite): CSSProperties {
  const { theme, site } = loaded;
  return {
    "--navy": theme.primary,
    "--gold": theme.accent,
    "--dgold": theme.accentOnLight,
    "--cream": theme.cream,
    "--ink": theme.ink,
    "--logo-h": `${site.logoHeight}px`,
  } as CSSProperties;
}

export function hasHeaderLogo(loaded: LoadedSite): boolean {
  return Boolean(loaded.site.logoAssetId || loaded.brandLogo.dark || loaded.brandLogo.light);
}

export function Logo({ loaded, variant = "dark" }: { loaded: LoadedSite; variant?: "dark" | "light" }) {
  const { base, site } = loaded;
  if (!hasHeaderLogo(loaded)) return <span className="wordmark">{site.name}</span>;
  return <img src={`${base}/logo?bg=${variant}&v=${site.updatedAt.getTime()}`} alt={site.name} />;
}

export function fmtDate(date: Date | null | undefined, timeZone: string, style: "short" | "long" = "short"): string {
  if (!date) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone, month: style === "long" ? "long" : "short", day: "numeric", year: "numeric" }).format(date);
}

export function ago(date: Date | null | undefined, now: Date, timeZone: string): string {
  if (!date) return "";
  const minutes = Math.round((now.getTime() - date.getTime()) / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  if (minutes < 60 * 48) return "Yesterday";
  return fmtDate(date, timeZone);
}

/** Featured image, or a branded placeholder. */
export function Img({ loaded, assetId, className = "img", light = false, alt = "", eager = false }: { loaded: LoadedSite; assetId: string | null | undefined; className?: string; light?: boolean; alt?: string; eager?: boolean }) {
  if (!assetId) return <div className={`${className} ph${light ? " light" : ""}`} aria-hidden />;
  return (
    <div className={className}>
      <img src={`${loaded.base}/media/${assetId}`} alt={alt} className="cover" loading={eager ? "eager" : "lazy"} decoding="async" />
    </div>
  );
}

/** Short line under a publication name: "Free daily", "Monthly", or what the caller passes. */
function subtitle(pub: Publication, sub?: string): string {
  if (sub !== undefined) return sub.slice(0, 32);
  const type = (pub.pubType ?? "").toLowerCase();
  const free = type === "free newsletter" || (pub.tier ?? "").toLowerCase() === "free / lead gen";
  const freq = (pub.frequency ?? "").trim();
  if (free) return freq ? `Free ${freq.toLowerCase()}` : "Free";
  return (freq || pub.tier || "").slice(0, 32);
}

/** A publication's mark: its logo from Publication Setup (dark-background slot), or its initial. */
export function PubBadge({ loaded, pub, size, sub, noName }: { loaded: LoadedSite; pub: Publication; size?: "sm" | "lg"; sub?: string; noName?: boolean }) {
  return (
    <span className={`pb${size ? ` ${size}` : ""}`}>
      <span className="em">
        {pub.hasLogo ? (
          <img src={`${loaded.base}/pub-logo/${pub.id}?bg=dark&v=${pub.updatedAt.getTime()}`} alt="" loading="lazy" />
        ) : (
          <span className="ini">{pub.name.replace(/^the\s+/i, "").slice(0, 1)}</span>
        )}
      </span>
      {noName ? null : (
        <span className="nm">
          {pub.name}
          {subtitle(pub, sub) ? <small>{subtitle(pub, sub)}</small> : null}
        </span>
      )}
    </span>
  );
}

export function editorOf(loaded: LoadedSite, post: { authorEditorId: string | null; authorName: string }) {
  return post.authorEditorId ? loaded.editors.find((editor) => editor.id === post.authorEditorId) : undefined;
}

export function EditorPhoto({ loaded, editorId, className = "av" }: { loaded: LoadedSite; editorId: string | null | undefined; className?: string }) {
  const editor = editorId ? loaded.editors.find((item) => item.id === editorId) : undefined;
  if (!editor?.hasPhoto) return <span className={className} aria-hidden />;
  return <img className={className} src={`${loaded.base}/editor-photo/${editor.id}?v=${editor.updatedAt.getTime()}`} alt="" loading="lazy" />;
}

/** Small gold label over a card: the publication, else the first category. */
export function Kicker({ loaded, post, gold }: { loaded: LoadedSite; post: CardPost; gold?: boolean }) {
  const pub = post.publicationId ? loaded.publications.find((item) => item.id === post.publicationId) : undefined;
  const category = post.terms.find((row) => row.term.kind === "category" && row.term.slug !== "uncategorized")?.term;
  const text = pub?.name ?? category?.name ?? contentTypeLabel(post.contentType);
  return (
    <span className={`label${gold ? " gold" : ""}`} style={{ fontSize: 11 }}>
      {text}
      {post.access === "members" ? " · 🔒" : ""}
    </span>
  );
}

export function SignupForm({ loaded, pub, back, button = "Sign up free", dark }: { loaded: LoadedSite; pub: Publication | undefined; back: string; button?: string; dark?: boolean }) {
  if (!pub) return null;
  return (
    <form className="inline" method="post" action={`${loaded.base}/subscribe`}>
      <input type="hidden" name="publicationId" value={pub.id} />
      <input type="hidden" name="back" value={back} />
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden style={{ position: "absolute", left: -9999, width: 1, height: 1 }} />
      <input type="email" name="email" required placeholder="Your email address" aria-label="Email address" />
      <button className={`btn ${dark ? "btn-gold" : "btn-navy"}`} type="submit">
        {button}
      </button>
    </form>
  );
}

export function FormNote({ status }: { status?: string }) {
  if (status === "subscribed") return <p className="note-ok">You&apos;re signed up. Check your inbox for a welcome email.</p>;
  if (status === "invalid") return <p className="note-err">Please enter a valid email address.</p>;
  if (status === "limited") return <p className="note-err">Too many sign-ups from this connection. Please try again later.</p>;
  return null;
}

/** Live strip from Massive (cached 5 minutes); hidden when nothing can be priced. */
async function Ticker({ text }: { text: string }) {
  const quotes = await tickerQuotes(text);
  if (!quotes.length) return null;
  return (
    <div className="ticker" aria-label="Markets">
      <div className="wrap">
        {quotes.map((quote) => (
          <span key={quote.symbol}>
            <b>{quote.label}</b> {formatPrice(quote.price, quote.symbol)}{" "}
            <span className={quote.change < 0 ? "dn" : "up"}>
              {quote.change < 0 ? "▼" : "▲"} {Math.abs(quote.changePct).toFixed(2)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Public site frame: ticker, header with menu, topic bar, footer. */
export function SiteShell({ loaded, member, active, children }: { loaded: LoadedSite; member: SignedInMember | null; active?: string; children: ReactNode }) {
  const { site, base, menu, topics } = loaded;
  const home = base || "/";
  return (
    <div className="ws" style={themeStyle(loaded)}>
      {loaded.staff && site.status !== "live" ? <div className="preview-bar">Preview: this site is not live yet. Only signed-in staff can see it.</div> : null}
      {site.showTicker ? <Ticker text={site.tickerText} /> : null}
      <header className="hdr">
        <div className="wrap">
          <a className="logo" href={home} aria-label={`${site.name} home`}>
            <Logo loaded={loaded} />
          </a>
          <nav className="main" aria-label="Main">
            {menu.map((item) =>
              item.children?.length ? (
                <div key={item.href + item.label} className="dd">
                  <a href={menuHref(base, item.href)} className={active && item.href === active ? "on" : undefined}>
                    {item.label}
                  </a>
                  <div className="sub">
                    <div>
                      {item.children.map((child) => (
                        <a key={child.href + child.label} href={menuHref(base, child.href)}>
                          {child.label}
                        </a>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <a key={item.href + item.label} href={menuHref(base, item.href)} className={active && item.href === active ? "on" : undefined}>
                  {item.label}
                </a>
              ),
            )}
          </nav>
          <div className="acts">
            {member ? (
              <a className="btn btn-gold btn-sm" href={`${base}/my`}>
                My Account
              </a>
            ) : (
<a className="btn btn-gold btn-sm" href={`${base}/sign-in`}>
                Member Login
              </a>
            )}
            <details className="menu-toggle">
              <summary aria-label="Menu">
                <span />
              </summary>
              <nav className="mobile-menu" aria-label="Menu">
                {menu.flatMap((item) => [
                  <a key={item.href + item.label} href={menuHref(base, item.href)}>
                    {item.label}
                  </a>,
                  ...(item.children ?? []).map((child) => (
                    <a key={`c${child.href}${child.label}`} className="child" href={menuHref(base, child.href)}>
                      {child.label}
                    </a>
                  )),
                ])}
                {topics.map((item) => (
                  <a key={`t${item.href}`} href={menuHref(base, item.href)}>
                    {item.label}
                  </a>
                ))}
                <a href={member ? `${base}/my` : `${base}/sign-in`}>{member ? "My Account" : "Member Login"}</a>
              </nav>
            </details>
          </div>
        </div>
        {topics.length ? (
          <div className="subnav">
            <div className="wrap">
              <b>TOPICS</b>
              {topics.flatMap((item) => [item, ...(item.children ?? [])]).map((item) => (
                <a key={item.href + item.label} href={menuHref(base, item.href)}>
                  {item.label}
                </a>
              ))}
            </div>
          </div>
        ) : null}
      </header>
      <main>{children}</main>
      <Footer loaded={loaded} />
    </div>
  );
}

export function Footer({ loaded }: { loaded: LoadedSite }) {
  const { site, base, free, paid } = loaded;
  return (
    <footer className="ftr">
      <div className="wrap">
        <div className="cols">
          <div>
            <a href={base || "/"} className="logo" style={{ display: "inline-block", marginBottom: 14, marginLeft: -10 }}>
              {hasHeaderLogo(loaded) ? (
                <img src={`${base}/logo?bg=dark&v=${site.updatedAt.getTime()}`} alt={site.name} style={{ height: Math.round(site.logoHeight * 0.75) }} />
              ) : (
                <span className="osw" style={{ color: "var(--cream)", fontSize: 22 }}>
                  {site.name}
                </span>
              )}
            </a>
            <p style={{ maxWidth: 340, margin: 0 }}>{site.footerText || site.tagline}</p>
          </div>
          <div>
            <h5>Free newsletters</h5>
            <ul>
              {free.slice(0, 5).map((pub) => (
                <li key={pub.id}>
                  <a href={`${base}/newsletters/${pub.slug}`}>{pub.name}</a>
                </li>
              ))}
              <li>
                <a href={`${base}/newsletters`}>All newsletters</a>
              </li>
            </ul>
          </div>
          <div>
            <h5>Research</h5>
            <ul>
              {paid.slice(0, 5).map((pub) => (
                <li key={pub.id}>
                  <a href={`${base}/research/${pub.slug}`}>{pub.name}</a>
                </li>
              ))}
              <li>
                <a href={`${base}/editors`}>Our editors</a>
              </li>
            </ul>
          </div>
          <div>
            <h5>Members</h5>
            <ul>
              <li>
                <a href={`${base}/sign-in`}>Member login</a>
              </li>
              <li>
                <a href={`${base}/my`}>My subscriptions</a>
              </li>
              {site.supportEmail ? (
                <li>
                  <a href={`mailto:${site.supportEmail}`}>Customer service</a>
                </li>
              ) : null}
            </ul>
          </div>
        </div>
        <div className="legal">
          © {new Date().getFullYear()} {site.name}. All rights reserved.
          {site.disclaimer ? `\n${site.disclaimer}` : ""}
        </div>
      </div>
    </footer>
  );
}

/** Members-area frame. */
export function MembersShell({ loaded, member, active, children }: { loaded: LoadedSite; member: SignedInMember; active: "home" | "research" | "alerts" | "account"; children: ReactNode }) {
  const { base, site } = loaded;
  const initials = (member.name || member.email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
  const nav = [
    ["home", "Dashboard", `${base}/my`],
    ["research", "My Research", `${base}/my/research`],
    ["alerts", "Alerts", `${base}/my/alerts`],
    ["account", "Account", `${base}/my/account`],
  ] as const;
  return (
    <div className="ws members" style={themeStyle(loaded)}>
      <header className="mhdr">
        <div className="wrap">
          <a className="logo" href={`${base}/my`} aria-label={`${site.name} members`} style={{ marginLeft: -10 }}>
            <Logo loaded={loaded} />
          </a>
          <span className="pill">MEMBERS</span>
          <nav aria-label="Members">
            {nav.map(([key, label, href]) => (
              <a key={key} href={href} className={active === key ? "on" : undefined}>
                {label}
              </a>
            ))}
            <a href={base || "/"}>Public site</a>
          </nav>
          <a className="me" href={`${base}/my/account`}>
            <span className="av">{initials || "M"}</span>
            <span className="n">{member.name || member.email}</span>
          </a>
        </div>
      </header>
      <main>{children}</main>
      <nav className="mobnav" aria-label="Members">
        {(
          [
            ["home", "⌂", "Home"],
            ["research", "▤", "Research"],
            ["alerts", "⚡", "Alerts"],
            ["account", "☺", "Account"],
          ] as const
        ).map(([key, icon, label]) => (
          <a key={key} href={nav.find((item) => item[0] === key)![2]} className={active === key ? "on" : undefined}>
            <b>{icon}</b>
            {label}
          </a>
        ))}
      </nav>
      <Footer loaded={loaded} />
    </div>
  );
}
