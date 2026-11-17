/**
 * Split a publisher's vault into what belongs to that publisher's own Brain
 * ("brand": its publications, editors, promos and results, operations) and
 * general know-how for the main Brain ("general": copywriting principles,
 * industry tactics, competitors, market and editorial craft).
 *
 * Deterministic rules only, in this order (first match wins):
 *   1. brand folder           e.g. "Areas/MTA/", "Resources/Editorial Issues/"
 *   2. brand name in the path e.g. "MTA", "Monument Traders", an editor or publication
 *   3. general folder         e.g. "Resources/Competitors/", "Resources/Industry Tactics/"
 *   4. brand front-matter tag e.g. tags: [publications/.../monument-traders-alliance]
 *   5. brand-heavy body       >= BODY_MENTIONS brand mentions
 *   6. otherwise general
 * The terms (editor and publication names) are passed in; nothing about any
 * publisher is hardcoded here.
 */
import { noteTags, parseFrontmatter } from "./vault";

export type Destination = "brand" | "general";

export type ClassifierRules = {
  /** Folder prefixes that are always the brand's own (case-insensitive). */
  brandFolders: readonly string[];
  /** Folder prefixes that are general know-how unless rule 2 says otherwise. */
  generalFolders: readonly string[];
  /** Brand names matched case-insensitively ("Monument Traders"). */
  brandNames: readonly string[];
  /** Short brand marks matched case-sensitively as whole words ("MTA"). */
  brandMarks: readonly string[];
  /** Editors / gurus ("Bryan Bottarelli"). */
  people: readonly string[];
  /** Publication names ("The War Room"). */
  publications: readonly string[];
  /** Publication codes matched case-sensitively as whole words in titles only ("WAR", "TPU"). */
  publicationCodes: readonly string[];
  /** Tag fragments that mark a note as the brand's ("monument-traders-alliance", "mta"). */
  brandTags: readonly string[];
};

export type Classification = {
  destination: Destination;
  rule: "brand-folder" | "brand-name-in-path" | "general-folder" | "brand-tag" | "brand-body" | "default";
  evidence: string[];
};

export const BODY_MENTIONS = 3;

function underPrefix(path: string, prefixes: readonly string[]): string | null {
  const lower = path.toLowerCase();
  for (const prefix of prefixes) {
    const p = prefix.toLowerCase().replace(/\/+$/, "");
    if (lower === p || lower.startsWith(`${p}/`) || lower === `${p}.md`) return prefix;
  }
  return null;
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s_-]+");
}

function wordRegex(term: string, flags: string): RegExp {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escape(term)}(?=$|[^\\p{L}\\p{N}])`, `${flags}u`);
}

type Matcher = { label: string; re: RegExp };

export type CompiledRules = {
  rules: ClassifierRules;
  insensitive: Matcher[];
  marks: Matcher[];
  codes: Matcher[];
};

export function compileRules(rules: ClassifierRules): CompiledRules {
  const unique = (list: readonly string[]) => [...new Set(list.map((item) => item.trim()).filter((item) => item.length >= 2))];
  return {
    rules,
    insensitive: unique([...rules.brandNames, ...rules.people, ...rules.publications]).map((term) => ({ label: term, re: wordRegex(term, "i") })),
    marks: unique(rules.brandMarks).map((term) => ({ label: term, re: wordRegex(term, "") })),
    codes: unique(rules.publicationCodes).map((term) => ({ label: term, re: wordRegex(term, "") })),
  };
}

/** Readable path for name matching: "Resources/Publications/THE-FIRST-MOVE-W-MATT-MCCALL.md" -> words. */
function pathWords(path: string): string {
  return path.replace(/\.md$/i, "").replace(/[_-]+/g, " ");
}

function countMatches(text: string, matchers: readonly Matcher[]): { count: number; labels: string[] } {
  let count = 0;
  const labels = new Set<string>();
  for (const matcher of matchers) {
    const global = new RegExp(matcher.re.source, `${matcher.re.flags.replace("g", "")}g`);
    const hits = text.match(global)?.length ?? 0;
    if (hits) {
      count += hits;
      labels.add(matcher.label);
    }
  }
  return { count, labels: [...labels] };
}

export function classifyNote(path: string, text: string, compiled: CompiledRules): Classification {
  const { rules } = compiled;
  const brandFolder = underPrefix(path, rules.brandFolders);
  if (brandFolder) return { destination: "brand", rule: "brand-folder", evidence: [brandFolder] };

  const words = pathWords(path);
  const title = words.split("/").pop() ?? words;
  const nameHits = [
    ...compiled.insensitive.filter((m) => m.re.test(words)).map((m) => m.label),
    ...compiled.marks.filter((m) => m.re.test(words)).map((m) => m.label),
    ...compiled.codes.filter((m) => m.re.test(title)).map((m) => m.label),
  ];
  if (nameHits.length) return { destination: "brand", rule: "brand-name-in-path", evidence: [...new Set(nameHits)] };

  const generalFolder = underPrefix(path, rules.generalFolders);
  if (generalFolder) return { destination: "general", rule: "general-folder", evidence: [generalFolder] };

  const tags = noteTags(text);
  const tagHits = tags.filter((tag) =>
    rules.brandTags.some((fragment) => {
      const f = fragment.toLowerCase();
      return tag === f || tag.split("/").includes(f) || tag.startsWith(`${f}-`) || tag.startsWith(`${f}/`);
    }),
  );
  if (tagHits.length) return { destination: "brand", rule: "brand-tag", evidence: tagHits.slice(0, 5) };

  const { body } = parseFrontmatter(text);
  const mentions = countMatches(body, [...compiled.insensitive, ...compiled.marks]);
  if (mentions.count >= BODY_MENTIONS) return { destination: "brand", rule: "brand-body", evidence: [`${mentions.count} mentions`, ...mentions.labels.slice(0, 5)] };

  return { destination: "general", rule: "default", evidence: mentions.count ? [`${mentions.count} brand mentions (below ${BODY_MENTIONS})`] : [] };
}

/**
 * Pull the names the classifier needs out of source files, without hardcoding
 * them: `name: 'Bryan Bottarelli'` lines from an editors file, and publication
 * codes and names from a Markdown table with `code` and `name` columns.
 */
export function namesFromSource(source: string): string[] {
  return [...source.matchAll(/(?:^|[{,\s])name:\s*['"]([^'"\n]{2,80})['"]/gm)].map((match) => match[1]!.trim());
}

export function publicationsFromTable(markdown: string): { code: string; name: string }[] {
  const lines = markdown.split(/\r?\n/).filter((line) => line.trim().startsWith("|"));
  const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
  const header = lines.find((line) => /\|\s*code\s*\|/i.test(line) && /\|\s*name\s*\|/i.test(line));
  if (!header) return [];
  const columns = cells(header).map((cell) => cell.toLowerCase());
  const codeAt = columns.indexOf("code");
  const nameAt = columns.indexOf("name");
  const out = new Map<string, string>();
  for (const line of lines) {
    if (line === header || /^\|\s*-{3}/.test(line.trim())) continue;
    const row = cells(line);
    const code = row[codeAt] ?? "";
    const name = row[nameAt] ?? "";
    if (/^[A-Z0-9]{2,12}$/.test(code) && name) out.set(code, name);
  }
  return [...out.entries()].map(([code, name]) => ({ code, name }));
}
