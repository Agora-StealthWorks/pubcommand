/**
 * Links in a competitor email. Pure: nothing here fetches a URL.
 * Emails wrap their links in click trackers; where the real destination is a
 * query parameter we unwrap it, otherwise the tracker URL is kept as-is.
 */
import { decodeEntities } from "./mime";

/** `count` is how many times the link appears in the email. */
export type EmailLink = { href: string; text: string; count: number };

const REDIRECT_PARAMS = ["url", "u", "redirect", "redirect_url", "redirecturl", "target", "dest", "destination", "link", "to", "r", "goto", "q"];

const UTILITY_TEXT = /unsubscribe|opt[\s-]?out|manage (your )?(preferences|subscription)|update (your )?(preferences|profile)|email preferences|view (this|it|in|online)|web ?version|privacy|terms|forward to a friend|whitelist|safe ?list|add us to/i;
const UTILITY_HREF = /unsubscribe|optout|opt-out|preferences|manage[-_]?subscription|list-manage\.com\/(unsubscribe|profile)|\/privacy|\/terms|view[-_]?(in[-_]?)?browser|webversion/i;
const SOCIAL_HOSTS = /(^|\.)(facebook|twitter|x|instagram|linkedin|youtube|tiktok|pinterest|threads)\.com$/;

/** If a tracker carries the real destination in a query parameter, return that. */
export function unwrapTrackingUrl(href: string): string {
  let current = href;
  for (let hop = 0; hop < 3; hop += 1) {
    let url: URL;
    try {
      url = new URL(current);
    } catch {
      return current;
    }
    let next: string | null = null;
    for (const [key, value] of url.searchParams) {
      if (!REDIRECT_PARAMS.includes(key.toLowerCase())) continue;
      const candidate = value.trim();
      if (/^https?:\/\//i.test(candidate)) {
        next = candidate;
        break;
      }
    }
    if (!next) return current;
    current = next;
  }
  return current;
}

function cleanHref(raw: string): string | null {
  const href = decodeEntities(raw.trim());
  if (!/^https?:\/\//i.test(href)) return null;
  try {
    return new URL(href).toString();
  } catch {
    return null;
  }
}

/** Links from the HTML anchors, plus bare URLs from the text body. Unique by href, in order. */
export function extractLinks(html: string | null, text: string, max = 80): EmailLink[] {
  const seen = new Map<string, EmailLink>();
  const add = (rawHref: string, label: string) => {
    const href = cleanHref(rawHref);
    if (!href) return;
    const unwrapped = unwrapTrackingUrl(href);
    const existing = seen.get(unwrapped);
    if (existing) {
      existing.count += 1;
      if (!existing.text && label) existing.text = label;
      return;
    }
    if (seen.size < max) seen.set(unwrapped, { href: unwrapped, text: label, count: 1 });
  };
  if (html) {
    const anchor = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
    for (const match of html.matchAll(anchor)) {
      const label = decodeEntities((match[4] ?? "").replace(/<img\b[^>]*\balt\s*=\s*"([^"]*)"[^>]*>/gi, " $1 ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
      add(match[1] ?? match[2] ?? match[3] ?? "", label.slice(0, 160));
    }
  }
  for (const match of text.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) add(match[0].replace(/[.,;:!?]+$/, ""), "");
  return [...seen.values()];
}

export function isUtilityLink(link: EmailLink): boolean {
  if (UTILITY_TEXT.test(link.text) || UTILITY_HREF.test(link.href)) return true;
  try {
    return SOCIAL_HOSTS.test(new URL(link.href).hostname.replace(/^www\./, ""));
  } catch {
    return true;
  }
}

/** The links worth reading: no unsubscribe, preference, privacy or social links. */
export function contentLinks(links: readonly EmailLink[]): EmailLink[] {
  return links.filter((link) => !isUtilityLink(link));
}

/**
 * Best guess at the promo's landing page without fetching anything: the content
 * link whose host and path repeat most (calls to action are linked several times),
 * ties going to the first one in the email.
 */
export function guessLandingUrl(links: readonly EmailLink[]): string | null {
  const candidates = contentLinks(links);
  if (!candidates.length) return null;
  const counts = new Map<string, { href: string; count: number; order: number; labelled: number }>();
  candidates.forEach((link, order) => {
    let key = link.href;
    try {
      const url = new URL(link.href);
      key = `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}`;
    } catch {
      // keep the href as the key
    }
    const entry = counts.get(key) ?? { href: link.href, count: 0, order, labelled: 0 };
    entry.count += link.count || 1;
    if (link.text) entry.labelled += 1;
    counts.set(key, entry);
  });
  const ranked = [...counts.values()].sort((a, b) => b.count - a.count || b.labelled - a.labelled || a.order - b.order);
  return ranked[0]?.href ?? null;
}

export function hostOf(href: string | null | undefined): string | null {
  if (!href) return null;
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
