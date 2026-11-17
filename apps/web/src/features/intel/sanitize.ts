import sanitizeHtml from "sanitize-html";

/**
 * Competitor email HTML → something safe to show. Defence in depth:
 * 1. sanitize-html strips scripts, event handlers, forms, frames and unknown schemes;
 * 2. remote images (tracking pixels included), CSS url()s, background attributes and
 *    @imports are removed unless the viewer turns remote images on;
 * 3. the page renders it in a sandboxed iframe (no scripts, no same-origin) whose
 *    Content-Security-Policy only allows inline/data images unless remote images are on.
 */

const TAGS = [
  "a", "abbr", "address", "b", "big", "blockquote", "br", "caption", "center", "cite", "code", "col", "colgroup",
  "dd", "del", "div", "dl", "dt", "em", "font", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "ins",
  "li", "mark", "ol", "p", "pre", "q", "s", "small", "span", "strike", "strong", "style", "sub", "sup",
  "table", "tbody", "td", "tfoot", "th", "thead", "tr", "tt", "u", "ul", "wbr",
];

const LAYOUT_ATTRS = ["align", "valign", "width", "height", "bgcolor", "border", "cellpadding", "cellspacing", "colspan", "rowspan", "dir", "lang", "title", "style", "class", "id", "role", "background"];

const REMOTE_URL = /url\(\s*(['"]?)\s*(?:https?:)?\/\/[^)]*\)/gi;

function isRemote(src: string): boolean {
  return /^\s*(https?:)?\/\//i.test(src);
}

function scrubCss(css: string, allowRemote: boolean, onBlocked: () => void): string {
  let out = css.replace(/expression\s*\(/gi, "(").replace(/javascript:/gi, "").replace(/-moz-binding[^;]*;?/gi, "").replace(/behavior\s*:[^;]*;?/gi, "");
  if (!allowRemote) {
    out = out.replace(/@import[^;]*;?/gi, () => {
      onBlocked();
      return "";
    });
    out = out.replace(REMOTE_URL, () => {
      onBlocked();
      return "none";
    });
  }
  return out;
}

export type SanitizedEmail = { html: string; blockedImages: number };

export function sanitizeEmailHtml(html: string, options: { allowRemoteImages: boolean }): SanitizedEmail {
  const allowRemote = options.allowRemoteImages;
  let blocked = 0;
  const onBlocked = () => {
    blocked += 1;
  };
  // sanitize-html passes <style> text through untouched, so scrub it first.
  const styled = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_match, css: string) => `<style>${scrubCss(css, allowRemote, onBlocked)}</style>`);
  const clean = sanitizeHtml(styled, {
    allowedTags: TAGS,
    allowVulnerableTags: true, // <style> only; nothing can run in the sandboxed frame
    allowedAttributes: {
      "*": LAYOUT_ATTRS,
      a: [...LAYOUT_ATTRS, "href", "name", "target", "rel"],
      img: [...LAYOUT_ATTRS, "src", "alt", "data-intel-blocked"],
      font: [...LAYOUT_ATTRS, "color", "face", "size"],
      td: [...LAYOUT_ATTRS, "nowrap"],
      th: [...LAYOUT_ATTRS, "nowrap", "scope"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: allowRemote ? ["http", "https", "data"] : ["data", "http", "https"] },
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    nonTextTags: ["script", "noscript", "textarea", "option", "title", "iframe", "object", "embed", "svg", "math", "template"],
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, ...(attribs.style ? { style: scrubCss(attribs.style, allowRemote, onBlocked) } : {}), target: "_blank", rel: "noopener noreferrer nofollow" },
      }),
      img: (tagName, attribs) => {
        const next: Record<string, string> = { ...attribs };
        delete next.srcset;
        if (next.style) next.style = scrubCss(next.style, allowRemote, onBlocked);
        const src = next.src ?? "";
        if (/^\s*data:/i.test(src) && !/^\s*data:image\/(png|gif|jpe?g|webp|bmp);/i.test(src)) delete next.src;
        if (!allowRemote && isRemote(src)) {
          onBlocked();
          delete next.src;
          next["data-intel-blocked"] = "1";
        }
        return { tagName, attribs: next };
      },
      "*": (tagName, attribs) => {
        const next: Record<string, string> = { ...attribs };
        if (next.style) next.style = scrubCss(next.style, allowRemote, onBlocked);
        if (next.background && (!allowRemote || !isRemote(next.background))) {
          if (isRemote(next.background)) onBlocked();
          delete next.background;
        }
        return { tagName, attribs: next };
      },
    },
  });
  return { html: clean, blockedImages: blocked };
}

/** A full document for the sandboxed iframe, with a CSP that matches the image setting. */
export function emailDocument(sanitized: string, options: { allowRemoteImages: boolean }): string {
  const imgSrc = options.allowRemoteImages ? "data: https:" : "data:";
  const csp = `default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'`;
  return [
    "<!doctype html><html><head><meta charset=\"utf-8\">",
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    '<meta name="referrer" content="no-referrer">',
    '<base target="_blank">',
    "<style>body{margin:0;padding:12px;font-family:system-ui,sans-serif;color:#111;background:#fff;overflow-wrap:anywhere}img{max-width:100%;height:auto}img[data-intel-blocked]{display:inline-block;min-width:24px;min-height:16px;background:#f2f4f7;outline:1px dashed #d0d5dd}table{max-width:100%}</style>",
    "</head><body>",
    sanitized,
    "</body></html>",
  ].join("");
}
