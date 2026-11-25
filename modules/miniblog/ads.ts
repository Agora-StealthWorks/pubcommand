/**
 * Mini-Blog ad zones. PURE.
 *
 * A Mini-Blog keeps a list of ad network codes (AdSense, Taboola, Kevel or any
 * custom snippet). Each post then picks what fills its two zones:
 *  - the top ad, above the post card;
 *  - the content ad, wherever the writer typed the [content ad] shortcode.
 * A zone holds nothing, a text ad (text + optional tracked link, the T-Letter
 * top ad) or one of the Mini-Blog's ad codes.
 *
 * Ad codes are raw HTML/script from an ad network. They are only editable with
 * miniblog.manage, never pass through the post sanitizer, and are rendered only
 * on public pages (never in the admin preview, which shows a placeholder).
 */

export const AD_NETWORKS = [
  { id: "adsense", label: "Google AdSense" },
  { id: "taboola", label: "Taboola" },
  { id: "kevel", label: "Kevel" },
  { id: "custom", label: "Other / custom HTML" },
] as const;

export type AdNetwork = (typeof AD_NETWORKS)[number]["id"];

export type AdCode = { id: string; name: string; network: AdNetwork; code: string };

export const MAX_AD_CODES = 20;
export const MAX_AD_CODE_LENGTH = 20_000;

/** The shortcode a writer puts in the body; the "Content ad" button inserts it. */
export const CONTENT_AD_SHORTCODE = "[content ad]";

export function networkLabel(network: string): string {
  return AD_NETWORKS.find((item) => item.id === network)?.label ?? "Custom";
}

function isNetwork(value: unknown): value is AdNetwork {
  return typeof value === "string" && AD_NETWORKS.some((item) => item.id === value);
}

/** Stored JSON → clean ad codes (unknown shapes dropped, ids unique, sizes capped). */
export function parseAdCodes(value: unknown): AdCode[] {
  if (!Array.isArray(value)) return [];
  const out: AdCode[] = [];
  const ids = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const id = typeof item.id === "string" && /^[a-z0-9-]{1,40}$/.test(item.id) ? item.id : null;
    const name = typeof item.name === "string" ? item.name.replace(/\s+/g, " ").trim().slice(0, 80) : "";
    const code = typeof item.code === "string" ? item.code.trim().slice(0, MAX_AD_CODE_LENGTH) : "";
    if (!id || ids.has(id) || !name || !code) continue;
    ids.add(id);
    out.push({ id, name, network: isNetwork(item.network) ? item.network : "custom", code });
    if (out.length >= MAX_AD_CODES) break;
  }
  return out;
}

/** What fills a zone. */
export type AdChoice = { kind: "none" } | { kind: "text" } | { kind: "code"; id: string };

export function parseAdChoice(value: string | null | undefined): AdChoice {
  const text = (value ?? "").trim();
  if (text === "text") return { kind: "text" };
  const code = /^code:([a-z0-9-]{1,40})$/.exec(text);
  if (code) return { kind: "code", id: code[1]! };
  return { kind: "none" };
}

export function adChoiceValue(choice: AdChoice): string {
  return choice.kind === "code" ? `code:${choice.id}` : choice.kind;
}

/** A submitted choice, kept only if it names a text ad or one of this Mini-Blog's codes. */
export function acceptAdChoice(value: string | null | undefined, codes: readonly AdCode[]): string {
  const choice = parseAdChoice(value);
  if (choice.kind === "code" && !codes.some((code) => code.id === choice.id)) return "none";
  return adChoiceValue(choice);
}

/** The options a post's zone dropdown offers. */
export function adChoiceOptions(codes: readonly AdCode[]): { value: string; label: string }[] {
  return [{ value: "none", label: "No ad" }, { value: "text", label: "Text ad (text + link)" }, ...codes.map((code) => ({ value: `code:${code.id}`, label: `${code.name} · ${networkLabel(code.network)}` }))];
}

export type ResolvedAd = { kind: "text"; text: string; link: string | null } | { kind: "code"; code: AdCode } | null;

/** What a zone renders: null when empty, a text ad without text, or a code that no longer exists. */
export function resolveAd(choiceValue: string | null | undefined, text: string | null | undefined, link: string | null | undefined, codes: readonly AdCode[]): ResolvedAd {
  const choice = parseAdChoice(choiceValue);
  if (choice.kind === "text") {
    const body = (text ?? "").trim();
    return body ? { kind: "text", text: body, link: (link ?? "").trim() || null } : null;
  }
  if (choice.kind === "code") {
    const code = codes.find((item) => item.id === choice.id);
    return code ? { kind: "code", code } : null;
  }
  return null;
}

const SHORTCODE_RE = /\[\s*content[\s_-]*ad\s*\]/i;
/** A paragraph that holds nothing but the shortcode (the editor wraps it in <p>). */
const SHORTCODE_PARAGRAPH_RE = /<p[^>]*>\s*\[\s*content[\s_-]*ad\s*\]\s*<\/p>/i;
const ALL_SHORTCODES_RE = /<p[^>]*>\s*\[\s*content[\s_-]*ad\s*\]\s*<\/p>|\[\s*content[\s_-]*ad\s*\]/gi;

export function hasContentAd(html: string): boolean {
  return SHORTCODE_RE.test(html);
}

/**
 * Split sanitized body HTML at the first [content ad] shortcode. Further
 * shortcodes are removed (one content ad per post). Without one, `after` is null.
 */
export function splitAtContentAd(html: string): { before: string; after: string | null } {
  const paragraph = SHORTCODE_PARAGRAPH_RE.exec(html);
  const inline = paragraph ? null : SHORTCODE_RE.exec(html);
  const match = paragraph ?? inline;
  if (!match) return { before: html, after: null };
  const before = html.slice(0, match.index);
  const after = html.slice(match.index + match[0].length).replace(ALL_SHORTCODES_RE, "");
  return { before, after };
}

/** The body with every shortcode removed (a post with no content ad picked). */
export function stripContentAd(html: string): string {
  return html.replace(ALL_SHORTCODES_RE, "");
}

/** A new ad-code id from a name, unique among the existing ones. */
export function newAdCodeId(name: string, existing: readonly AdCode[]): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30) || "ad";
  let id = base;
  for (let n = 2; existing.some((code) => code.id === id); n += 1) id = `${base}-${n}`;
  return id;
}
