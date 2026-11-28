import { createHmac, timingSafeEqual } from "node:crypto";
import { sanitizeEmailHtml } from "../intel/sanitize";

/**
 * ISpy's email reader always shows images, but never lets a publisher see who is
 * reading: every remote image goes through PubCommand's image proxy (/api/ispy/img,
 * a signed URL so it is not an open proxy), and tracking pixels are dropped.
 */
function secret(): string {
  const value = process.env.AUTH_SECRET ?? "";
  if (value.length < 16) throw new Error("AUTH_SECRET must be at least 16 characters.");
  return value;
}

export function signImageUrl(url: string): string {
  return createHmac("sha256", `ispy-img:${secret()}`).update(url).digest("base64url").slice(0, 32);
}

export function verifyImageUrl(url: string, signature: string): boolean {
  const expected = Buffer.from(signImageUrl(url));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function proxiedImageUrl(origin: string, url: string): string {
  return `${origin}/api/ispy/img?u=${encodeURIComponent(url)}&s=${signImageUrl(url)}`;
}

const PIXEL_URL = /(\/open(\.|\/|\?)|\/track(ing)?\/|\/pixel|\/beacon|\/wf\/open|\/o\.gif|\/e\/o\/|[?&](open|track)=|\/imp\?|spacer\.gif|1x1)/i;

function isPixel(tag: string): boolean {
  const w = tag.match(/\bwidth\s*=\s*["']?(\d+)/i)?.[1];
  const h = tag.match(/\bheight\s*=\s*["']?(\d+)/i)?.[1];
  if ((w && Number(w) <= 2) || (h && Number(h) <= 2)) return true;
  if (/(^|;)\s*(width|height)\s*:\s*[0-2]px/i.test(tag.match(/\bstyle\s*=\s*"([^"]*)"/i)?.[1] ?? "")) return true;
  if (/display\s*:\s*none/i.test(tag)) return true;
  const src = tag.match(/\bsrc\s*=\s*"([^"]*)"/i)?.[1] ?? "";
  return PIXEL_URL.test(src);
}

/** Sanitized HTML with every remote image rewritten to the proxy and pixels removed. */
export function ispyEmailHtml(html: string, origin: string): { html: string; pixelsRemoved: number } {
  const { html: clean } = sanitizeEmailHtml(html, { allowRemoteImages: true });
  let pixels = 0;
  const proxy = (url: string) => (/^https?:\/\//i.test(url) ? proxiedImageUrl(origin, url.replace(/&amp;/g, "&")) : url);
  const out = clean
    .replace(/<img\b[^>]*>/gi, (tag) => {
      if (isPixel(tag)) {
        pixels += 1;
        return "";
      }
      return tag.replace(/\bsrc\s*=\s*"([^"]*)"/i, (_m, src: string) => `src="${proxy(src)}"`);
    })
    .replace(/url\(\s*(['"]?)(https?:\/\/[^'")]+)\1\s*\)/gi, (_m, _q: string, url: string) => `url("${proxy(url)}")`)
    .replace(/\bbackground\s*=\s*"(https?:\/\/[^"]+)"/gi, (_m, url: string) => `background="${proxy(url)}"`);
  return { html: out, pixelsRemoved: pixels };
}

/** The sandboxed iframe document: images only from the proxy (and data: URIs). */
export function ispyEmailDocument(html: string, origin: string): string {
  const csp = `default-src 'none'; img-src data: ${origin}; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'`;
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    '<meta name="referrer" content="no-referrer">',
    '<base target="_blank">',
    "<style>body{margin:0;padding:12px;font-family:system-ui,sans-serif;color:#111;background:#fff;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}</style>",
    "</head><body>",
    html,
    "</body></html>",
  ].join("");
}
