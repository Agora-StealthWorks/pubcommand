/**
 * Landing pages: what a competitor's email or video sends people to. We keep
 * readable text only (no screenshot: there is no browser in the production image).
 * Pure: the fetch itself goes through `guardedFetch` (url-guard.ts) with injected IO.
 */
import { extractLinks, type EmailLink } from "./links";
import { decodeEntities, htmlToText } from "./mime";

/** Fetch and storage limits. */
export const LANDING_MAX_BYTES = 3 * 1024 * 1024;
export const LANDING_TIMEOUT_MS = 15_000;
export const LANDING_MAX_TEXT = 60_000;
/** How much landing text goes into an AI extraction. */
export const LANDING_PROMPT_TEXT = 8_000;
/** A captured page younger than this is reused instead of fetched again. */
export const LANDING_REUSE_MS = 7 * 86_400_000;

export type ParsedLanding = {
  title: string | null;
  description: string | null;
  headings: string[];
  text: string;
  links: EmailLink[];
};

function clean(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  const text = decodeEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

function metaContent(html: string, name: string): string | null {
  const pattern = new RegExp(`<meta\\b[^>]*(?:name|property)\\s*=\\s*["']${name}["'][^>]*>`, "i");
  const tag = html.match(pattern)?.[0];
  if (!tag) return null;
  return tag.match(/\bcontent\s*=\s*"([^"]*)"/i)?.[1] ?? tag.match(/\bcontent\s*=\s*'([^']*)'/i)?.[1] ?? null;
}

/** Title, description, h1–h3 headings, body text and links from a page's HTML. */
export function parseLandingHtml(html: string, baseUrl: string): ParsedLanding {
  const source = html.slice(0, LANDING_MAX_BYTES);
  const title = clean(source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1], 300) ?? clean(metaContent(source, "og:title"), 300);
  const description = clean(metaContent(source, "description") ?? metaContent(source, "og:description"), 600);
  const body = source
    .replace(/<(script|style|noscript|svg|template|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const headings: string[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const text = clean(match[2], 300);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    headings.push(text);
    if (headings.length >= 25) break;
  }
  const text = htmlToText(body).slice(0, LANDING_MAX_TEXT);
  const links = extractLinks(absolutize(body, baseUrl), "", 80);
  return { title, description, headings, text, links };
}

/** Rewrite relative hrefs so link extraction sees absolute URLs. */
function absolutize(html: string, baseUrl: string): string {
  return html.replace(/(<a\b[^>]*?\bhref\s*=\s*)(["'])([^"']*)\2/gi, (whole, start: string, quote: string, href: string) => {
    try {
      return `${start}${quote}${new URL(decodeEntities(href), baseUrl).toString()}${quote}`;
    } catch {
      return whole;
    }
  });
}

/** The charset a response declares, defaulting to UTF-8. */
export function decodeHtmlBytes(body: Uint8Array, contentType: string): string {
  const declared = contentType.match(/charset=([^;\s]+)/i)?.[1]?.toLowerCase();
  const sniffed = declared ?? new TextDecoder("latin1").decode(body.slice(0, 2048)).match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1]?.toLowerCase();
  try {
    return new TextDecoder(sniffed || "utf-8").decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

export function isHtmlContentType(contentType: string): boolean {
  return !contentType || /text\/html|application\/xhtml\+xml/.test(contentType);
}

/** The landing-page block appended to an extraction prompt. */
export function landingPromptBlock(page: { url: string; finalUrl: string | null; title: string | null; description?: string | null; headings: readonly string[]; text: string } | null): string {
  if (!page) return "";
  const text = page.text.length > LANDING_PROMPT_TEXT ? `${page.text.slice(0, LANDING_PROMPT_TEXT)}\n[…page truncated]` : page.text;
  return [
    "",
    "The landing page it links to (fetched by us, text only):",
    `URL: ${page.finalUrl ?? page.url}`,
    page.title ? `Title: ${page.title}` : null,
    page.description ? `Description: ${page.description}` : null,
    page.headings.length ? `Headings: ${page.headings.slice(0, 12).join(" | ")}` : null,
    "Page text:",
    text || "(no readable text)",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
