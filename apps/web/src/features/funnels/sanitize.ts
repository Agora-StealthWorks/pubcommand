import sanitizeHtml from "sanitize-html";
import { sanitizeRichText } from "@/components/rich-text-editor/sanitize";

/**
 * Rich text written in the builder (footers, close message, day notes, posts).
 * Sanitized on save AND again on render, so an old row can never carry script.
 * The rules are the shared rich-text editor's (`components/rich-text-editor/sanitize.ts`).
 */
export function sanitizeRich(html: string | null | undefined, max = 100_000): string {
  return sanitizeRichText(html, max);
}

/**
 * Text typed in a plain textarea becomes paragraphs; text that already looks
 * like HTML is sanitized as is.
 */
export function richFromInput(input: string | null | undefined, max = 100_000): string {
  const text = String(input ?? "").replace(/\r\n?/g, "\n").trim();
  if (!text) return "";
  if (/<\/?(p|br|strong|b|em|i|u|s|a|ul|ol|li|h[1-6]|blockquote|div|span|img|hr|small|mark|iframe)\b[^>]*>/i.test(text)) return sanitizeRich(text, max);
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const linkify = (value: string) => value.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  const html = text
    .split(/\n{2,}/)
    .map((block) => `<p>${linkify(escape(block)).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return sanitizeRich(html, max);
}

/**
 * The textarea value for stored rich text. Text that was typed plainly (only
 * paragraphs, line breaks and bare links) goes back to plain text, so editing
 * never shows markup the author did not write. Anything richer stays HTML.
 */
export function richToInput(html: string | null | undefined): string {
  const value = String(html ?? "").trim();
  if (!value) return "";
  const stripped = value.replace(/<\/?p>|<br\s*\/?>|<a href="([^"]+)"[^>]*>\1<\/a>/g, "");
  if (/<[a-z/][^>]*>/i.test(stripped)) return value;
  const unescape = (text: string) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  return unescape(
    value
      .replace(/<a href="([^"]+)"[^>]*>\1<\/a>/g, "$1")
      .replace(/\r?\n?<br\s*\/?>\r?\n?/g, "\n")
      .replace(/<\/p>\s*<p>/g, "\n\n")
      .replace(/<\/?p>/g, ""),
  ).trim();
}


/**
 * Calendar-button embed code (e.g. a Livendar "Add to calendar" snippet).
 * Scripts, event handlers, iframes and forms are stripped; links, images and
 * their inline styling are kept, and every link opens in a new tab. Run on save
 * and again on render.
 */
export function sanitizeEmbed(html: string | null | undefined, max = 50_000): string {
  const input = String(html ?? "").slice(0, max);
  if (!input.trim()) return "";
  return sanitizeHtml(input, {
    allowedTags: ["a", "div", "span", "p", "br", "img", "strong", "em", "b", "i", "small", "ul", "ol", "li", "button", "svg", "path", "g", "circle", "rect"],
    allowedAttributes: {
      "*": ["class", "style", "title", "aria-label", "role"],
      a: ["href", "target", "rel"],
      img: ["src", "alt", "width", "height"],
      svg: ["viewBox", "width", "height", "fill", "xmlns"],
      path: ["d", "fill"],
      circle: ["cx", "cy", "r", "fill"],
      rect: ["x", "y", "width", "height", "rx", "fill"],
      g: ["fill"],
    },
    allowedSchemes: ["https", "http", "mailto"],
    allowedSchemesByTag: { img: ["https"] },
    allowedStyles: {
      "*": {
        color: [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z]+$/i],
        "background-color": [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z]+$/i],
        background: [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z]+$/i],
        "border-radius": [/^[\d.]+(px|em|rem|%)$/],
        border: [/^[\d.]+px\s+(solid|dashed|dotted)\s+(#[0-9a-f]{3,8}|[a-z]+)$/i],
        padding: [/^([\d.]+(px|em|rem)\s*){1,4}$/],
        margin: [/^([\d.]+(px|em|rem)|auto)(\s+([\d.]+(px|em|rem)|auto)){0,3}$/],
        "font-size": [/^[\d.]+(px|em|rem)$/],
        "font-weight": [/^(bold|normal|[1-9]00)$/],
        "font-family": [/^[\w\s,"'-]+$/],
        "text-decoration": [/^(none|underline)$/],
        "text-align": [/^(left|right|center)$/],
        display: [/^(inline-block|inline-flex|block|flex|inline)$/],
        gap: [/^[\d.]+(px|em|rem)$/],
        "line-height": [/^[\d.]+(px|em|rem)?$/],
        width: [/^[\d.]+(px|em|rem|%)$/],
        height: [/^[\d.]+(px|em|rem|%)$/],
        "max-width": [/^[\d.]+(px|em|rem|%)$/],
        "align-items": [/^(center|flex-start|flex-end)$/],
        "justify-content": [/^(center|flex-start|flex-end|space-between)$/],
        "flex-wrap": [/^(wrap|nowrap)$/],
      },
    },
    transformTags: { a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }) },
  });
}
