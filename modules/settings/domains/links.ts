/**
 * Public links that use the page's custom domain. PURE.
 *
 * Every link PubCommand shows for a public page (Preview buttons, "Public link"
 * boxes, share and embed links, links copied into the Calendar) goes to the
 * page's custom domain when one is set up (Settings → Domains, status Active),
 * and to the organization's PubCommand address only when there is none.
 *
 * A domain points at a public page (its target, e.g. `/b/digest`). A path under
 * that target is served at the same place under the domain root:
 * `/b/digest/morning-note` → `https://maha-link.com/morning-note`. When the rest
 * of the path would be read as a public prefix (a post called "f"), or the path
 * is a sibling of the target (`/embed/x` for a `/f/x` domain), the full public
 * path is used instead (`https://host/b/digest/f`), which every custom domain
 * serves as-is (see `decideCustomHost`).
 */
import { PUBLIC_PREFIXES, REFUSED_PREFIXES } from "./routing";

export type LinkDomain = { hostname: string; targetPath: string };

/** Paths that are the same page under another prefix: Mini-Blogs (`/b/` and the old `/t/`), forms and their embeds. */
const ALIASES: Record<string, string[]> = { b: ["t"], t: ["b"], f: ["embed"], embed: ["f"] };

function clean(path: string): string {
  return `/${path.split("/").filter(Boolean).join("/")}`.toLowerCase();
}

/** The part of `path` under `target` ("" for the target itself), or null when it is not under it. */
function under(path: string, target: string): string | null {
  if (path === target) return "";
  return path.startsWith(`${target}/`) ? path.slice(target.length) : null;
}

/** `target` with its first segment swapped for each alias (`/b/x` → `/t/x`). */
function aliasesOf(target: string): string[] {
  const [, prefix = "", ...rest] = target.split("/");
  return (ALIASES[prefix] ?? []).map((other) => `/${[other, ...rest].join("/")}`);
}

const SPECIAL = new Set<string>([...PUBLIC_PREFIXES, ...REFUSED_PREFIXES]);

/**
 * The custom-domain URL for a public path (with an optional query), or null
 * when no domain serves it. With several matches the most specific target wins
 * (a `/w/site/my` domain over a `/w/site` one), then the first in the list.
 */
export function customDomainUrl(domains: readonly LinkDomain[], pathWithQuery: string): string | null {
  const [rawPath = "/", query = ""] = pathWithQuery.split(/\?(.*)/s);
  const path = clean(rawPath);
  const search = query ? `?${query}` : "";
  let best: { domain: LinkDomain; rest: string; exact: boolean; length: number } | null = null;
  for (const domain of domains) {
    const target = clean(domain.targetPath);
    const rest = under(path, target);
    if (rest !== null) {
      if (!best || !best.exact || target.length > best.length) best = { domain, rest, exact: true, length: target.length };
      continue;
    }
    // The same page under an alias prefix: served at its full public path.
    if (!best && aliasesOf(target).some((alias) => under(path, alias) !== null)) best = { domain, rest: path, exact: false, length: 0 };
  }
  if (!best) return null;
  const host = `https://${best.domain.hostname.toLowerCase()}`;
  if (!best.exact) return `${host}${path}${search}`;
  if (!best.rest) return `${host}/${search}`;
  const first = best.rest.split("/")[1] ?? "";
  // A first segment the domain would read as a public prefix or an app path: use the full public path.
  return SPECIAL.has(first) ? `${host}${path}${search}` : `${host}${best.rest}${search}`;
}
