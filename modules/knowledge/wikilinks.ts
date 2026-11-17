/** Obsidian-style [[Wiki links]]: parsing, matching and resolution. */

export type WikiLink = {
  /** The raw text inside the brackets. */
  raw: string;
  /** The note being linked, without heading or alias ("Resources/Jeff Brown"). */
  target: string;
  heading: string | null;
  alias: string | null;
  /** ![[...]] embeds (images, transclusions). */
  embed: boolean;
};

const LINK = /(!?)\[\[([^[\]\n]+?)\]\]/g;

/** Parse one link body, e.g. "Jeff Brown#Track record|Jeff". */
export function parseWikiLinkBody(raw: string, embed = false): WikiLink | null {
  const body = raw.trim();
  if (!body) return null;
  const pipe = body.indexOf("|");
  const beforeAlias = pipe >= 0 ? body.slice(0, pipe) : body;
  const alias = pipe >= 0 ? body.slice(pipe + 1).trim() || null : null;
  const hash = beforeAlias.indexOf("#");
  const target = (hash >= 0 ? beforeAlias.slice(0, hash) : beforeAlias).trim();
  const heading = hash >= 0 ? beforeAlias.slice(hash + 1).trim() || null : null;
  if (!target && !heading) return null;
  return { raw: body, target, heading, alias, embed };
}

/** Blank out fenced code blocks and inline code so links inside them are ignored. */
export function maskCode(markdown: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, " ");
  let fence: string | null = null;
  return markdown
    .split("\n")
    .map((line) => {
      const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1] ?? null;
      if (fence) {
        if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
        return blank(line);
      }
      if (marker) {
        fence = marker;
        return blank(line);
      }
      return line.replace(/`[^`\n]+`/g, blank);
    })
    .join("\n");
}

/** Every [[link]] in a note, in order, ignoring code. */
export function parseWikiLinks(markdown: string): WikiLink[] {
  const links: WikiLink[] = [];
  for (const match of maskCode(markdown).matchAll(LINK)) {
    const link = parseWikiLinkBody(match[2] ?? "", match[1] === "!");
    if (link) links.push(link);
  }
  return links;
}

/** The key two titles are compared by: last path segment, no .md, case and spacing folded. */
export function titleKey(value: string): string {
  const last = value.replace(/\\/g, "/").split("/").pop() ?? value;
  return last
    .replace(/\.md$/i, "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export type LinkCandidate = { id: string; title: string; brandId: string | null; visibility: "PRIVATE" | "SHARED" };

/**
 * Build a resolver over the notes visible in one scope. When two visible notes
 * share a title, the scope's own brand wins, then any other.
 */
export function linkResolver<T extends LinkCandidate>(notes: readonly T[], preferBrandId: string | null) {
  const byKey = new Map<string, T>();
  const rank = (note: T) => (note.brandId === preferBrandId ? 0 : note.brandId === null ? 1 : 2);
  for (const note of notes) {
    const key = titleKey(note.title);
    const current = byKey.get(key);
    if (!current || rank(note) < rank(current)) byKey.set(key, note);
  }
  return (target: string): T | null => (target ? byKey.get(titleKey(target)) ?? null : null);
}

/** True when `markdown` links to a note called `title`. Used to confirm backlinks. */
export function linksTo(markdown: string, title: string): boolean {
  const key = titleKey(title);
  return parseWikiLinks(markdown).some((link) => !link.embed && titleKey(link.target) === key);
}
