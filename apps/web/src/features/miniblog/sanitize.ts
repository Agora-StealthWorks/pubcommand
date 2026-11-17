import { sanitizeRichText } from "@/components/rich-text-editor/sanitize";

/**
 * Rich text in a Mini-Blog (subscribe-page intro, posts).
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
