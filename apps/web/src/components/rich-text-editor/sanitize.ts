import sanitizeHtml from "sanitize-html";

const NONE: sanitizeHtml.Attributes = {};
import { EMBED_HOSTS, embedSrc } from "./embed";

/**
 * The sanitizer for everything the rich-text editor writes: headings,
 * paragraphs, lists, quotes, links, colours, highlights, alignment, images
 * (with wrap and width classes) and video embeds from allow-listed players.
 * Apps run it on save AND on render, so an old or hand-crafted row can never
 * carry script, event handlers, arbitrary styles or foreign iframes.
 */
const COLOR = [/^#[0-9a-f]{3,8}$/i, /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/i];
const ALIGN = [/^(left|right|center|justify)$/];
export const IMAGE_CLASSES = ["rte-img", "rte-img-left", "rte-img-right", "rte-img-center", "rte-img-full", "rte-w-25", "rte-w-33", "rte-w-50", "rte-w-75", "rte-w-100"];

export const RICH_TEXT_SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "s", "a", "ul", "ol", "li", "h2", "h3", "h4", "blockquote", "hr", "img", "span", "small", "mark", "div", "iframe"],
  allowedAttributes: {
    a: ["href", "target", "rel"],
    img: ["src", "alt", "width", "height", "class"],
    span: ["style"],
    mark: ["style", "data-color"],
    p: ["style"],
    h2: ["style"],
    h3: ["style"],
    h4: ["style"],
    li: ["style"],
    div: ["class"],
    iframe: ["src", "title", "allow", "allowfullscreen", "frameborder", "loading"],
  },
  allowedClasses: { img: IMAGE_CLASSES, div: ["rte-embed"] },
  allowedStyles: {
    span: { color: COLOR, "background-color": COLOR, "font-weight": [/^(bold|[4-9]00)$/] },
    mark: { "background-color": COLOR, color: COLOR },
    p: { "text-align": ALIGN },
    h2: { "text-align": ALIGN },
    h3: { "text-align": ALIGN },
    h4: { "text-align": ALIGN },
    li: { "text-align": ALIGN },
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesByTag: { img: ["https"], iframe: ["https"] },
  allowedIframeHostnames: [...EMBED_HOSTS],
  allowIframeRelativeUrls: false,
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, rel: "noopener noreferrer", ...(attribs.target === "_blank" ? { target: "_blank" } : {}) },
    }),
    // Only player URLs survive (normalized), with fixed safe attributes.
    iframe: (tagName, attribs): sanitizeHtml.Tag => {
      const src = embedSrc(attribs.src ?? "");
      return src
        ? { tagName, attribs: { src, title: (attribs.title ?? "Video").slice(0, 120), allow: "autoplay; fullscreen; picture-in-picture; encrypted-media", allowfullscreen: "true", frameborder: "0", loading: "lazy" } }
        : { tagName: "span", attribs: NONE };
    },
    div: (tagName, attribs) => ({ tagName, attribs: attribs.class === "rte-embed" ? { class: "rte-embed" } : NONE }),
  },
  exclusiveFilter: (frame) => frame.tag === "iframe" && !frame.attribs.src,
};

export function sanitizeRichText(html: string | null | undefined, max = 100_000): string {
  return sanitizeHtml(String(html ?? "").slice(0, max), RICH_TEXT_SANITIZE).trim();
}
