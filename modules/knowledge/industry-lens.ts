/**
 * The Master Brain's lens: an expert knowledge base for the publishing
 * industry. It takes no side. "Competitors" are an organization's view (Intel
 * keeps them per organization); in the Master Brain the same companies are
 * simply publishers in the industry.
 *
 * Applied when notes enter the Master Brain (learn-up, vault import) and to
 * notes already there. Organizations' own Brains keep their wording.
 * Pure and idempotent: framing a framed note changes nothing.
 */

/** Exact names (note titles, folders, link targets) renamed everywhere, links included so they still resolve. */
const NAMES: readonly [RegExp, string][] = [
  [/\bCompetitor Promos\b/g, "Industry Promos"],
  [/\bPast Competitor Editorial\b/g, "Past Industry Editorial"],
  [/\bCompetitor [Ii]ntel\b/g, "Industry intel"],
  [/\bCompetitor Analysis\b/g, "Industry Analysis"],
];

/** Folder segments renamed. */
const SEGMENTS: Record<string, string> = {
  competitors: "Industry Companies",
  "competitor promos": "Industry Promos",
  "competitor intel": "Industry intel",
};

/** Prose rewrites, outside links. Order matters: specific phrases before single words. */
const PROSE: readonly [RegExp, string | ((match: string, ...groups: string[]) => string)][] = [
  [/\b(?:our|their|its|your|MTA['’]s|Monument Traders Alliance['’]s)\s+(?:main\s+|key\s+|biggest\s+|top\s+)?competitors\b/gi, "other publishers"],
  [/\b(?:our|their|its|your|MTA['’]s)\s+(?:main\s+|key\s+|biggest\s+|top\s+)?competitor\b/gi, "another publisher"],
  [/\bcompeting publishers\b/gi, "other publishers"],
  [/\bCompetitor (promo|email|video|newsletter|editorial|webinar|launch|offer|page)/g, (_m, word: string) => `Industry ${word}`],
  [/\bcompetitor (promo|email|video|newsletter|editorial|webinar|launch|offer|page)/g, (_m, word: string) => `industry ${word}`],
  [/\bCompetitors\b/g, "Publishers"],
  [/\bcompetitors\b/g, "publishers"],
  [/\bCompetitor['’]s\b/g, "Publisher's"],
  [/\bcompetitor['’]s\b/g, "publisher's"],
  [/\bCompetitor\b/g, "Publisher"],
  [/\bcompetitor\b/g, "publisher"],
  [/\bCOMPETITORS\b/g, "PUBLISHERS"],
  [/\bCOMPETITOR\b/g, "PUBLISHER"],
];

function applyNames(text: string): string {
  return NAMES.reduce((out, [pattern, to]) => out.replace(pattern, to), text);
}

function applyProse(text: string): string {
  return PROSE.reduce((out, [pattern, to]) => out.replace(pattern, to as string), text);
}

/** Text: names everywhere; prose rewrites outside [[links]], `code` and URLs. */
export function frameText(text: string): string {
  const named = applyNames(text);
  // Keep link targets, inline code, fenced code and URLs as they are (names were already renamed above).
  const parts = named.split(/(\[\[[^\]\n]*\]\]|```[\s\S]*?```|`[^`\n]*`|https?:\/\/\S+)/g);
  return parts.map((part, index) => (index % 2 === 1 ? part : applyProse(part))).join("");
}

/** A note title: "Competitor promo: X" → "Industry promo: X", then the text rules. */
export function frameTitle(title: string): string {
  return frameText(applyNames(title).replace(/^Competitor (\w)/, (_m, first: string) => `Industry ${first.toLowerCase()}`));
}

/** A folder path ("Resources/Competitors/Agora" → "Resources/Industry Companies/Agora"). */
export function frameFolder(folder: string | null): string | null {
  if (folder === null) return null;
  return folder
    .split("/")
    .map((segment) => SEGMENTS[segment.trim().toLowerCase()] ?? applyNames(segment))
    .join("/");
}

/** A vault path: folders and the file name (the note's title). */
export function framePath(path: string): string {
  const parts = path.split("/");
  const file = parts.pop() ?? "";
  const ext = /\.[a-z0-9]+$/i.exec(file)?.[0] ?? "";
  const base = ext ? file.slice(0, -ext.length) : file;
  const folder = parts.length ? frameFolder(parts.join("/")) : null;
  return `${folder ? `${folder}/` : ""}${frameTitle(base)}${ext}`;
}

export function frameNote<T extends { title: string; body: string; folder: string | null }>(note: T): T {
  return { ...note, title: frameTitle(note.title), body: frameText(note.body), folder: frameFolder(note.folder) };
}

/** True when framing would change the note. */
export function needsFraming(note: { title: string; body: string; folder: string | null }): boolean {
  const framed = frameNote(note);
  return framed.title !== note.title || framed.body !== note.body || framed.folder !== note.folder;
}
