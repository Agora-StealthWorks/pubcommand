/**
 * Header code pasted by an admin (tracking pixels, tag managers, site
 * verification). PURE. `<meta>` and `<link>` tags belong in the page head, so
 * they are pulled out and rendered there as real elements (only well-known
 * attributes); everything else is placed, unchanged, at the top of the body.
 * This is trusted admin code (funnels.publish only): it is not sanitized, it
 * is only ever placed on public pages, never in previews.
 */
export type HeadTag = { tag: "meta" | "link"; attrs: Record<string, string> };

const HEAD_TAG_RE = /<(meta|link)\b([^>]*?)\/?>/gi;
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
const META_ATTRS = new Set(["name", "content", "property", "http-equiv", "charset", "itemprop"]);
const LINK_ATTRS = new Set(["rel", "href", "as", "type", "sizes", "media", "crossorigin", "hreflang", "title", "referrerpolicy"]);

export function parseAttrs(source: string, allowed: ReadonlySet<string>): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of source.matchAll(ATTR_RE)) {
    const name = match[1]!.toLowerCase();
    if (allowed.has(name)) attrs[name] = (match[2] ?? match[3] ?? match[4] ?? "").slice(0, 2000);
  }
  return attrs;
}

/** Split header code into head tags and the rest. Comments are kept with the rest. */
export function splitHeadCode(code: string): { headTags: HeadTag[]; bodyHtml: string } {
  const headTags: HeadTag[] = [];
  const text = code.slice(0, 50_000);
  // Leave <meta>/<link> inside <script>, <noscript> or comments alone.
  const protectedRanges: [number, number][] = [];
  for (const match of text.matchAll(/<(script|noscript|style)\b[\s\S]*?<\/\1\s*>|<!--[\s\S]*?-->/gi)) protectedRanges.push([match.index!, match.index! + match[0].length]);
  const inside = (index: number) => protectedRanges.some(([start, end]) => index >= start && index < end);
  const bodyHtml = text
    .replace(HEAD_TAG_RE, (whole, tag: string, attrs: string, offset: number) => {
      if (inside(offset)) return whole;
      const kind = tag.toLowerCase() as "meta" | "link";
      const parsed = parseAttrs(attrs, kind === "meta" ? META_ATTRS : LINK_ATTRS);
      if (kind === "link" && (!parsed.href || /^\s*javascript:/i.test(parsed.href))) return "";
      if (kind === "meta" && !parsed.content && !parsed.charset) return "";
      headTags.push({ tag: kind, attrs: parsed });
      return "";
    })
    .trim();
  return { headTags: headTags.slice(0, 40), bodyHtml };
}

/** React prop names for head tag attributes. */
export function reactAttrs(attrs: Record<string, string>): Record<string, string> {
  const map: Record<string, string> = { "http-equiv": "httpEquiv", crossorigin: "crossOrigin", hreflang: "hrefLang", referrerpolicy: "referrerPolicy", itemprop: "itemProp", charset: "charSet" };
  return Object.fromEntries(Object.entries(attrs).map(([key, value]) => [map[key] ?? key, value]));
}
