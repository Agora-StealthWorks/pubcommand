/**
 * Extra facts ISpy reads off a landing page: its declared canonical URL, the video
 * player ids on it, a text fingerprint, and a link to a transcript / "full page" /
 * text version when the page offers one (in the body or the footer). Pure.
 */
import { unwrapTrackingUrl } from "../intel/links";
import { decodeEntities, htmlToText } from "../intel/mime";
import { findEmbeddedVideos } from "../intel/video";
import { canonicalKey } from "./promo-links";
import { fingerprintCopy } from "./copy";

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i")) ?? tag.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i"));
  return m ? decodeEntities(m[1]!).trim() || null : null;
}

function absolute(href: string, base: string): string | null {
  try {
    const url = new URL(href, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** `<link rel="canonical">` and `og:url`, as absolute URLs. */
export function declaredUrls(html: string, base: string): { relCanonical: string | null; ogUrl: string | null } {
  const link = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).find((tag) => /\brel\s*=\s*["']?canonical\b/i.test(tag));
  const og = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]).find((tag) => /(property|name)\s*=\s*["']og:url["']/i.test(tag));
  const relCanonical = link ? absolute(attr(link, "href") ?? "", base) : null;
  const ogUrl = og ? absolute(attr(og, "content") ?? "", base) : null;
  return { relCanonical, ogUrl };
}

/** Stable ids of the video players on the page ("wistia:abc123"). */
export function videoIds(html: string, base: string): string[] {
  const ids = new Set<string>();
  for (const video of findEmbeddedVideos(html, base, 8)) {
    const url = video.url;
    const id =
      url.match(/wistia\.(?:com|net)\/(?:medias|embed\/iframe|embed\/medias)\/([a-z0-9]{6,})/i)?.[1] ??
      url.match(/player\.vimeo\.com\/video\/(\d+)/i)?.[1] ??
      url.match(/vimeo\.com\/(\d+)/i)?.[1] ??
      url.match(/(?:youtube\.com\/embed\/|youtu\.be\/|[?&]v=)([\w-]{11})/i)?.[1] ??
      url.match(/jwplatform\.com\/(?:players|videos|previews)\/([a-z0-9]{8})/i)?.[1] ??
      url.match(/vidalytics\.com\/embeds?\/[^/]+\/([\w-]{6,})/i)?.[1] ??
      null;
    if (id) ids.add(`${video.platform}:${id}`);
  }
  for (const m of html.matchAll(/wistia_async_([a-z0-9]{6,})/gi)) ids.add(`wistia:${m[1]}`);
  return [...ids].slice(0, 6);
}

/** Visible text and its SimHash (for "same sales letter on another URL"). */
export function pageText(html: string): { text: string; simhash: string | null; hash: string | null } {
  const text = htmlToText(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")).slice(0, 60_000);
  const fp = fingerprintCopy(text);
  return { text, simhash: fp.words >= 80 ? fp.simhash : null, hash: fp.words >= 80 ? fp.hash : null };
}

const TRANSCRIPT_TEXT =
  /\b(transcript|read (the |this )?(full |entire |complete )?(transcript|presentation|letter|report|text|story|version)|prefer (to )?read|rather read|text version|print(able)? version|full (page|text|letter|presentation)|read instead|click here to read|read it here|view (the )?(text|transcript))\b/i;
const TRANSCRIPT_HREF = /(transcript|text[-_]?version|txt[-_]?version|print[-_]?version|[-_/]text\b|[-_/]txt\b|[-_/]read\b|full[-_]?(page|text|letter))/i;
const NOT_TRANSCRIPT = /(privacy|terms|unsubscribe|disclaimer|cookie|contact|login|order|checkout|cart|faq|about)/i;

export type TranscriptLink = { url: string; text: string } | null;

/**
 * A link to a transcript or text version of the promo, if the page has one. Many
 * promo pages don't: then null ("not detected"). Looks at every anchor, footer
 * included; an anchor that only jumps within the page (#transcript) counts too.
 */
export function findTranscriptLink(html: string, base: string): TranscriptLink {
  let best: { url: string; text: string; score: number } | null = null;
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]{0,400}?)<\/a>/gi)) {
    const tag = m[1] ?? "";
    const rawHref = attr(`<a ${tag}>`, "href");
    if (!rawHref || /^(javascript|mailto|tel):/i.test(rawHref)) continue;
    const text = decodeEntities((m[2] ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    const href = rawHref.startsWith("#") ? rawHref : unwrapTrackingUrl(rawHref);
    const textHit = TRANSCRIPT_TEXT.test(text) || TRANSCRIPT_TEXT.test(attr(`<a ${tag}>`, "title") ?? "");
    const hrefHit = TRANSCRIPT_HREF.test(href);
    if (!textHit && !hrefHit) continue;
    if (NOT_TRANSCRIPT.test(text) || (NOT_TRANSCRIPT.test(href) && !hrefHit)) continue;
    const url = href.startsWith("#") ? `${base.split("#")[0]}${href}` : absolute(href, base);
    if (!url) continue;
    const score = (textHit ? 2 : 0) + (hrefHit ? 1 : 0) + (/transcript/i.test(text + href) ? 2 : 0);
    if (!best || score > best.score) best = { url, text: text.slice(0, 120) || href, score };
  }
  // A transcript written straight into the page ("Video Transcript" heading).
  if (!best && /<(h[1-4]|strong|b)[^>]*>\s*(video )?transcript\s*:?\s*<\//i.test(html)) {
    return { url: base, text: "Transcript on the page" };
  }
  return best ? { url: best.url, text: best.text } : null;
}

/** Canonical keys a page can be reached by (its final URL plus what it declares). */
export function pageKeys(finalUrl: string, declared: { relCanonical: string | null; ogUrl: string | null }): string[] {
  const keys = new Set<string>([canonicalKey(finalUrl)]);
  for (const url of [declared.relCanonical, declared.ogUrl]) if (url) keys.add(canonicalKey(url));
  return [...keys];
}
