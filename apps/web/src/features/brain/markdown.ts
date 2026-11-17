import { Marked, type TokenizerAndRendererExtension, type Tokens } from "marked";
import sanitizeHtml from "sanitize-html";
import { parseFrontmatter } from "../../../../../modules/knowledge/vault";
import { parseWikiLinkBody, type WikiLink } from "../../../../../modules/knowledge/wikilinks";

/** What a [[link]] points at, or null when no visible note has that title. */
export type LinkTarget = { href: string; title: string } | null;

type WikiToken = Tokens.Generic & { link: WikiLink };

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function wikiExtension(resolve: (target: string) => LinkTarget): TokenizerAndRendererExtension {
  return {
    name: "wikilink",
    level: "inline",
    start(src: string) {
      const index = src.search(/!?\[\[/);
      return index < 0 ? undefined : index;
    },
    tokenizer(src: string) {
      const match = /^(!?)\[\[([^[\]\n]+?)\]\]/.exec(src);
      if (!match) return undefined;
      const link = parseWikiLinkBody(match[2] ?? "", match[1] === "!");
      if (!link) return undefined;
      return { type: "wikilink", raw: match[0], link } as WikiToken;
    },
    renderer(token) {
      const { link } = token as WikiToken;
      const label = escapeHtml(link.alias ?? (link.target ? link.target.split("/").pop() ?? link.target : `#${link.heading ?? ""}`));
      if (link.embed) return `<span class="brain-embed" title="Attachments are not imported">${label}</span>`;
      if (!link.target) return `<span class="brain-link-local">${label}</span>`;
      const target = resolve(link.target);
      if (!target) return `<span class="brain-link-missing" title="No note called “${escapeHtml(link.target)}” in this Brain">${label}</span>`;
      return `<a class="brain-link" href="${escapeHtml(target.href)}">${label}</a>`;
    },
  };
}

const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: [
    ...sanitizeHtml.defaults.allowedTags,
    "img",
    "del",
    "ins",
    "mark",
    "input",
    "details",
    "summary",
  ],
  allowedAttributes: {
    a: ["href", "title", "class", "rel", "target"],
    span: ["class", "title"],
    img: ["src", "alt", "title"],
    th: ["align"],
    td: ["align"],
    input: ["type", "checked", "disabled"],
    code: ["class"],
    "*": [],
  },
  allowedClasses: { span: ["brain-embed", "brain-link-missing", "brain-link-local", "mark"], a: ["brain-link"], code: [/^language-[\w-]+$/] },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["https"] },
  allowProtocolRelative: false,
  transformTags: {
    a: (tagName, attribs) => {
      const href = attribs.href ?? "";
      const external = /^https?:\/\//i.test(href);
      return { tagName, attribs: external ? { ...attribs, rel: "noopener noreferrer nofollow", target: "_blank" } : attribs };
    },
    input: (tagName, attribs) => ({ tagName, attribs: { ...attribs, disabled: "disabled" } }),
  },
};

/**
 * Render a note's Markdown to safe HTML: GitHub-flavoured Markdown, [[wiki links]]
 * resolved through `resolve`, then sanitized (no scripts, styles, iframes or
 * event handlers). Front matter is returned separately as properties.
 */
export function renderNote(body: string, resolve: (target: string) => LinkTarget): { html: string; properties: [string, string][] } {
  const { data, body: content, raw } = parseFrontmatter(body);
  const marked = new Marked({ gfm: true, breaks: false, async: false });
  marked.use({ extensions: [wikiExtension(resolve)] });
  const html = marked.parse(content) as string;
  const properties: [string, string][] = raw
    ? Object.entries(data).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : value])
    : [];
  return { html: sanitizeHtml(html, SANITIZE), properties };
}

/** Render AI answer Markdown (no wiki links). [n] markers become links to the cited notes. */
export function renderAnswer(markdown: string, hrefFor: (n: number) => string | null): string {
  const marked = new Marked({ gfm: true, breaks: false, async: false });
  const html = marked.parse(markdown) as string;
  const linked = html.replace(/\[(\d{1,2})\]/g, (match, n: string) => {
    const href = hrefFor(Number(n));
    return href ? `<a class="brain-link" href="${escapeHtml(href)}">[${n}]</a>` : match;
  });
  return sanitizeHtml(linked, SANITIZE);
}
