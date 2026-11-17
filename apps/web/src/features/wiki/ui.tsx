import Link from "next/link";
import { CHANNEL_LABELS, type Channel } from "../../../../../modules/testimonials/testimonials";
import { initials, safeHref } from "../../../../../modules/wiki/wiki";
import { logoFor, type LogoBackground, type LogoOwner, type LogoSlots } from "../../../../../modules/pubsetup/logos";
import type { PublicTestimonial } from "../testimonials/read";

export type WikiImageKind = "pub-logo" | "pub-logo-dark" | "pub-cover" | "editor-photo" | "brand-logo" | "brand-logo-dark" | "testimonial-photo";

/** The wiki URL of the best logo for a background (publication, then brand fallback), and the slot used. */
export function wikiLogo(owner: LogoOwner | null, background: LogoBackground, brand?: LogoOwner | null): { src: string; slot: LogoBackground } | null {
  const choice = logoFor(owner, background, brand);
  return choice ? { src: wikiImage(choice.kind, choice.id, choice.version ?? undefined), slot: choice.slot } : null;
}

export function wikiImage(kind: WikiImageKind, id: string, version?: Date | string | number): string {
  const v = version instanceof Date ? version.getTime() : version;
  return `/wiki/image/${kind}/${id}${v != null ? `?v=${encodeURIComponent(String(v))}` : ""}`;
}

export function WikiNav({ active }: { active: "home" | "publications" | "editors" }) {
  const tabs = [
    ["home", "/wiki", "Home"],
    ["publications", "/wiki/publications", "Publications"],
    ["editors", "/wiki/editors", "Editors"],
  ] as const;
  return (
    <nav className="-mx-1 mb-5 flex gap-1 overflow-x-auto border-b border-line" aria-label="Wiki sections">
      {tabs.map(([key, href, label]) => (
        <Link key={key} href={href} className={`inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm font-medium ${active === key ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"}`}>
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function SearchBox({ action, q, placeholder, children }: { action: string; q: string; placeholder: string; children?: React.ReactNode }) {
  return (
    <form action={action} method="get" role="search" className="flex flex-wrap gap-2">
      <label htmlFor="wiki-q" className="sr-only">
        Search
      </label>
      <input id="wiki-q" name="q" type="search" defaultValue={q} placeholder={placeholder} className="pc-control min-w-0 flex-1 basis-56" />
      {children}
      <button type="submit" className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-sm font-semibold text-white">
        Search
      </button>
    </form>
  );
}

/** A publication's logo on a white tile (the logo for light backgrounds; a dark tile when only the other exists). */
export function PubLogo({ pub, size = "md" }: { pub: { id: string; code: string; color: string; logos: LogoSlots; updatedAt: Date }; size?: "sm" | "md" | "lg" }) {
  const box = size === "lg" ? "h-24 w-24 sm:h-28 sm:w-28" : size === "sm" ? "h-9 w-9" : "h-14 w-14";
  const logo = wikiLogo(pub, "light");
  if (logo) {
    return <img src={logo.src} alt="" className={`${box} shrink-0 rounded-lg border border-line object-contain p-1`} style={{ background: logo.slot === "dark" ? "#111827" : "#ffffff" }} />;
  }
  return (
    <span className={`${box} flex shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white`} style={{ background: pub.color }} aria-hidden>
      {pub.code.slice(0, 4)}
    </span>
  );
}

export function Avatar({ editor, size = "md" }: { editor: { id: string; name: string; hasPhoto: boolean; updatedAt: Date }; size?: "sm" | "md" | "lg" }) {
  const box = size === "lg" ? "h-28 w-28 text-2xl" : size === "sm" ? "h-9 w-9 text-xs" : "h-14 w-14 text-base";
  if (editor.hasPhoto) {
    return <img src={wikiImage("editor-photo", editor.id, editor.updatedAt)} alt="" className={`${box} shrink-0 rounded-full border border-line object-cover`} />;
  }
  return (
    <span className={`${box} flex shrink-0 items-center justify-center rounded-full bg-[#dbe7ff] font-semibold text-[#1e3a8a]`} aria-hidden>
      {initials(editor.name)}
    </span>
  );
}

export function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border border-line bg-white p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  if (children == null || children === "" || (Array.isArray(children) && children.length === 0)) return null;
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</dt>
      <dd className="mt-1 whitespace-pre-line break-words text-sm [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

export function ExternalLink({ href, children }: { href: string | null | undefined; children: React.ReactNode }) {
  const safe = safeHref(href);
  if (!safe) return null;
  return (
    <a href={safe} target="_blank" rel="noreferrer noopener" className="text-accent [overflow-wrap:anywhere] hover:underline">
      {children}
    </a>
  );
}

function Stars({ rating }: { rating: number | null }) {
  if (!rating) return null;
  return (
    <span className="text-sm text-[#b54708]" aria-label={`${rating} out of 5 stars`}>
      {"★".repeat(rating)}
      <span className="text-line">{"★".repeat(5 - rating)}</span>
    </span>
  );
}

/** An approved testimonial as the wiki shows it. Links back to its publication and editor pages. */
export function TestimonialCard({
  t,
  publication,
  editor,
  manageHref,
}: {
  t: PublicTestimonial;
  publication?: { slug: string; name: string } | null;
  editor?: { slug: string; name: string } | null;
  manageHref?: string | null;
}) {
  return (
    <figure className="flex h-full min-w-0 flex-col gap-3 rounded-xl border border-line bg-white p-4">
      <div className="flex items-start gap-3">
        {t.photoId ? (
          <img src={wikiImage("testimonial-photo", t.photoId)} alt="" className="h-10 w-10 shrink-0 rounded-full border border-line object-cover" />
        ) : (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-canvas text-sm font-semibold text-muted" aria-hidden>
            {initials(t.displayName)}
          </span>
        )}
        <figcaption className="min-w-0 flex-1 text-sm">
          <span className="block font-semibold [overflow-wrap:anywhere]">{t.displayName}</span>
          <span className="block break-words text-xs text-muted">
            {[t.location, t.givenOn, CHANNEL_LABELS[t.channel as Channel] ?? t.channel]
              .filter(Boolean)
              .map((part, i) => (
                <span key={i} className="whitespace-nowrap">
                  {i ? " · " : ""}
                  {part}
                </span>
              ))}
          </span>
        </figcaption>
        <Stars rating={t.rating} />
      </div>
      <blockquote className="whitespace-pre-line text-[15px] leading-relaxed text-ink [overflow-wrap:anywhere]">&ldquo;{t.quote}&rdquo;</blockquote>
      {t.resultClaimed ? <p className="text-sm text-muted [overflow-wrap:anywhere]">Result claimed: {t.resultClaimed}</p> : null}
      {t.disclosure ? <p className="rounded-md bg-canvas px-2.5 py-1.5 text-xs text-muted [overflow-wrap:anywhere]">{t.disclosure}</p> : null}
      <div className="mt-auto flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {publication ? (
          <Link href={`/wiki/publications/${publication.slug}`} className="text-accent hover:underline">
            {publication.name}
          </Link>
        ) : null}
        {editor ? (
          <Link href={`/wiki/editors/${editor.slug}`} className="text-accent hover:underline">
            {editor.name}
          </Link>
        ) : null}
        <ExternalLink href={t.videoUrl}>Watch video</ExternalLink>
        {manageHref ? (
          <Link href={manageHref} className="text-muted hover:text-ink hover:underline">
            Open in Testimonials
          </Link>
        ) : null}
      </div>
    </figure>
  );
}

export function TestimonialGrid({
  items,
  pubs,
  editors,
  canManage,
}: {
  items: PublicTestimonial[];
  pubs: Map<string, { slug: string; name: string }>;
  editors: Map<string, { slug: string; name: string }>;
  canManage: boolean;
}) {
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {items.map((t) => (
        <li key={t.id} className="min-w-0">
          <TestimonialCard
            t={t}
            publication={t.publicationId ? pubs.get(t.publicationId) : null}
            editor={t.editorId ? editors.get(t.editorId) : null}
            manageHref={canManage ? `/testimonials/${t.id}` : null}
          />
        </li>
      ))}
    </ul>
  );
}
