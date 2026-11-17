import { createHash } from "node:crypto";

/**
 * Main-Brain conflict review: compare what Publication Setup says about a
 * publication or editor (the source of truth) with what main-Brain notes say.
 *
 * Pure code only (no DB, no AI calls). Two layers share these types:
 * - rule layer: deterministic extractors below read statements out of note text
 *   (names, codes, editor assignments, prices, frequency, launch dates, titles,
 *   status) and compare them with the facts;
 * - AI layer: `conflictPrompt()` + `CONFLICT_SCHEMA`, and `normalizeAiConflicts()`
 *   which drops anything whose quote is not really in the note.
 */

export type EntityKind = "publication" | "editor";
export type FactFields = Record<string, string | string[]>;

export type ConflictEntity = {
  kind: EntityKind;
  id: string;
  name: string;
  /** Code (publication) or other names the Brain may use. */
  aliases: string[];
  fields: FactFields;
  /** Names of the brand's other publications and editors: a sentence about one of them is not about this entity. */
  otherNames?: string[];
  /** The brand's publications (for editor ↔ publication checks). */
  knownPublications?: { name: string; code: string }[];
};

export type ConflictNote = { id: string; title: string; body: string; strength: 1 | 2 | 3 };

export type Statement = {
  factKey: string;
  noteId: string;
  /** Verbatim text from the note (a substring of its body). */
  quote: string;
  /** What the note says, in words ("weekly", "$79 per year", "edited by Bo Park"). */
  noteSays: string;
  /** The exact token in the quote that disagrees, when one can be replaced. */
  noteValue: string | null;
  /** What that token should read according to Publication Setup. */
  suggestedValue: string | null;
  agrees: boolean;
  confidence: number;
  rule: string;
};

export type ConflictCandidate = {
  factKey: string;
  factValue: string;
  noteId: string;
  noteSays: string;
  quote: string;
  noteValue: string | null;
  suggestedValue: string | null;
  confidence: number;
  layer: "rule" | "ai";
  rule: string | null;
};

export const FACT_LABELS: Record<string, string> = {
  name: "Name",
  code: "Code",
  status: "Status",
  frequency: "Frequency",
  launchDate: "Launch date",
  offers: "Price points and offers",
  editors: "Editors",
  publications: "Publications",
  title: "Title",
  tagline: "Tagline",
  pubType: "Type",
  tier: "Tier",
  description: "Short description",
  longDescription: "Long description",
  positioning: "Positioning",
  audience: "Audience",
  deliverables: "What readers get",
  credentials: "Credentials",
  trackRecord: "Track record",
  specialties: "Specialties",
  shortBio: "Short bio",
  longBio: "Bio",
  websiteUrl: "Website",
  signupUrl: "Sign-up page",
  senderName: "Sender name",
};

export function factLabel(key: string): string {
  return FACT_LABELS[key] ?? key;
}

export function factText(value: string | string[] | undefined): string {
  if (value == null) return "";
  return Array.isArray(value) ? value.join("; ") : value;
}

// ── Hashing and change detection ───────────────────────────────────────────

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Hash of the facts (field values only; the facts' own `updatedAt` never counts). */
export function factsHash(fields: FactFields): string {
  return sha(stable(fields));
}

export function factHash(key: string, value: string | string[] | undefined): string {
  return sha(`${key}\u0000${stable(value ?? null)}`);
}

export function noteHash(body: string): string {
  return sha(body);
}

/** Hash of the set of matching notes and their text. */
export function notesHash(notes: readonly { id: string; body: string }[]): string {
  return sha(
    [...notes]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((note) => `${note.id}:${noteHash(note.body)}`)
      .join("|"),
  );
}

export type RecheckReason = "never-checked" | "facts-changed" | "notes-changed" | "failed-before" | "forced";

/** Whether an entity needs a new check: its facts or its matching notes changed since the last one. */
export function recheckReason(
  previous: { factsHash: string; notesHash: string; status: string } | null,
  current: { factsHash: string; notesHash: string },
  force = false,
): RecheckReason | null {
  if (force) return "forced";
  if (!previous) return "never-checked";
  if (previous.factsHash !== current.factsHash) return "facts-changed";
  if (previous.notesHash !== current.notesHash) return "notes-changed";
  if (previous.status === "failed" || previous.status === "queued") return "failed-before";
  return null;
}

// ── Passages ────────────────────────────────────────────────────────────────

export type Passage = { text: string; heading: string | null; listItem: boolean };

const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=["“(\[]?[A-Z0-9$])/;

/** Note text → sentences and list items, each a verbatim substring of the body, with its section heading. */
export function splitPassages(body: string): Passage[] {
  const out: Passage[] = [];
  let heading: string | null = null;
  let inFence = false;
  const lines = body.split("\n");
  lines.forEach((raw, index) => {
    const line = raw.replace(/\r$/, "");
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    if (index === 0 && line.trim() === "---") return;
    if (line.trim() === "---") return;
    const h = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (h) {
      heading = h[1]!.trim();
      return;
    }
    const prefix = /^\s*(?:>\s*)*(?:[-*+]\s+|\d+[.)]\s+)?/.exec(line)?.[0] ?? "";
    const listItem = /[-*+]\s+$|\d+[.)]\s+$/.test(prefix);
    const content = line.slice(prefix.length).replace(/\s+$/, "");
    if (!content.trim()) return;
    for (const piece of content.split(SENTENCE_SPLIT)) {
      const text = piece.trim();
      if (text) out.push({ text, heading, listItem });
    }
  });
  return out;
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
}

function wordRe(names: readonly string[]): RegExp | null {
  const clean = names.map((n) => n.replace(/\s+/g, " ").trim()).filter((n) => n.length >= 2);
  if (!clean.length) return null;
  clean.sort((a, b) => b.length - a.length);
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${clean.map(escapeRe).join("|")})(?![\\p{L}\\p{N}])`, "iu");
}

function maskNames(text: string, names: readonly string[]): string {
  const re = wordRe(names);
  return re ? text.replace(new RegExp(re.source, "giu"), (m) => " ".repeat(m.length)) : text;
}

function mentions(text: string, names: readonly string[]): boolean {
  return wordRe(names)?.test(text) ?? false;
}

/** A passage is about the entity when it names it, or the whole note is about it and the passage names no other entity. */
export function aboutEntity(passage: Passage, entity: ConflictEntity, note: Pick<ConflictNote, "strength">): boolean {
  if (mentions(passage.text, [entity.name, ...entity.aliases])) return true;
  if (note.strength < 2) return false;
  const others = (entity.otherNames ?? []).filter((n) => n.toLowerCase() !== entity.name.toLowerCase());
  return !mentions(passage.text, others);
}

export function normalizeName(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']s\b/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/^(the|a|an) /, "")
    .trim();
}

// ── Frequency ───────────────────────────────────────────────────────────────

export const FREQUENCY_VALUES = ["Daily", "Weekdays", "Several times a week", "Weekly", "Every two weeks", "Monthly", "Quarterly"] as const;

const FREQUENCY_PATTERNS: [RegExp, (typeof FREQUENCY_VALUES)[number]][] = [
  [/\b(?:every|each)\s+weekday\b|\bweekdays\b|\bmonday\s+(?:through|to|-|–)\s+friday\b|\bfive\s+(?:days|times)\s+a\s+week\b/i, "Weekdays"],
  [/\b(?:twice|two\s+times|three\s+times|several\s+times|2x|3x)\s+(?:a|per|each)\s+week\b|\bsemi-?weekly\b/i, "Several times a week"],
  [/\bbi-?weekly\b|\bfortnightly\b|\bevery\s+(?:two|2|other)\s+weeks?\b/i, "Every two weeks"],
  [/\bdaily\b|\bevery\s+(?:day|morning|evening|trading\s+day)\b|\beach\s+(?:day|morning|trading\s+day)\b/i, "Daily"],
  [/\bweekly\b|\bevery\s+week\b|\bonce\s+a\s+week\b|\bevery\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\beach\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i, "Weekly"],
  [/\bmonthly\b|\bevery\s+month\b|\bonce\s+a\s+month\b/i, "Monthly"],
  [/\bquarterly\b|\bevery\s+(?:quarter|three\s+months)\b/i, "Quarterly"],
];

const FREQUENCY_CUE = /\b(publish(?:es|ed)?|comes?\s+out|issues?|edition|newsletter|letter|update|sent|sends|delivered|arrives?|frequency|goes\s+out|is\s+an?|mails?|lands)\b/i;

/** Frequencies a passage gives, canonical ("Weekly"). Several in one passage are ambiguous and ignored by the rule. */
export function extractFrequencies(text: string): { value: (typeof FREQUENCY_VALUES)[number]; raw: string }[] {
  let rest = text;
  const out: { value: (typeof FREQUENCY_VALUES)[number]; raw: string }[] = [];
  for (const [re, value] of FREQUENCY_PATTERNS) {
    const global = new RegExp(re.source, "gi");
    let match: RegExpExecArray | null;
    while ((match = global.exec(rest))) {
      if (!out.some((item) => item.value === value)) out.push({ value, raw: match[0] });
      rest = rest.slice(0, match.index) + " ".repeat(match[0].length) + rest.slice(match.index + match[0].length);
      global.lastIndex = match.index + match[0].length;
    }
  }
  return out;
}

function frequencyCompatible(fact: string, note: string): boolean {
  const f = fact.toLowerCase();
  const n = note.toLowerCase();
  if (f === n) return true;
  const daily = new Set(["daily", "weekdays"]);
  return daily.has(f) && daily.has(n);
}

// ── Dates ───────────────────────────────────────────────────────────────────

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";

export type PartialDate = { year: number; month: number | null; day: number | null; raw: string };

function monthIndex(name: string): number {
  return MONTHS.findIndex((m) => m.startsWith(name.toLowerCase().replace(/\.$/, "").slice(0, 3))) + 1;
}

/** "launched in May 2024", "founded on May 1, 2024", "since 2019", "launched 2024-05-01". */
export function extractLaunchDates(text: string): PartialDate[] {
  const out: PartialDate[] = [];
  const verb = "(?:launched|launch(?:ed)?\\s+date|founded|started|debuted|began|introduced|first\\s+published|established|created|went\\s+live|launch)";
  const patterns: RegExp[] = [
    new RegExp(`\\b${verb}\\b[^.;\\n]{0,30}?\\b(\\d{4})-(\\d{2})-(\\d{2})\\b`, "gi"),
    new RegExp(`\\b${verb}\\b[^.;\\n]{0,30}?\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "gi"),
    new RegExp(`\\b${verb}\\b[^.;\\n]{0,30}?\\b${MONTH_RE}\\s+(?:of\\s+)?(\\d{4})\\b`, "gi"),
    new RegExp(`\\b${verb}\\b[^.;\\n]{0,30}?\\b(?:in|on|during)\\s+(?:early\\s+|late\\s+|mid-?)?((?:19|20)\\d{2})\\b`, "gi"),
    new RegExp(`\\b${verb}\\b\\s*:?\\s*((?:19|20)\\d{2})\\b`, "gi"),
    /\b(?:published|running|around|out|live)\s+since\s+((?:19|20)\d{2})\b/gi,
  ];
  const seen = new Set<number>();
  patterns.forEach((re, kind) => {
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      const at = match.index;
      if ([...seen].some((s) => Math.abs(s - at) < 3)) continue;
      let date: PartialDate | null = null;
      if (kind === 0) date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), raw: `${match[1]}-${match[2]}-${match[3]}` };
      else if (kind === 1) date = { year: Number(match[3]), month: monthIndex(match[1]!), day: Number(match[2]), raw: match[0].slice(match[0].search(new RegExp(MONTH_RE, "i"))) };
      else if (kind === 2) date = { year: Number(match[2]), month: monthIndex(match[1]!), day: null, raw: match[0].slice(match[0].search(new RegExp(MONTH_RE, "i"))) };
      else date = { year: Number(match[1]), month: null, day: null, raw: match[1]! };
      if (date && date.year >= 1900 && date.year <= 2100) {
        seen.add(at);
        out.push(date);
      }
    }
  });
  return out;
}

export function parseFactDate(value: string): PartialDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  return m ? { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), raw: value } : null;
}

/** The fact date written at the note's precision: "2024", "May 2024" or "May 1, 2024". */
export function formatDateLike(fact: PartialDate, like: PartialDate): string {
  const month = fact.month ? MONTHS[fact.month - 1]!.replace(/^./, (c) => c.toUpperCase()) : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(like.raw)) return fact.raw.slice(0, 10);
  if (like.day != null && fact.month && fact.day) return `${month} ${fact.day}, ${fact.year}`;
  if (like.month != null && fact.month) return `${month} ${fact.year}`;
  return String(fact.year);
}

function datesAgree(fact: PartialDate, note: PartialDate): boolean {
  if (fact.year !== note.year) return false;
  if (note.month != null && fact.month != null && note.month !== fact.month) return false;
  if (note.day != null && fact.day != null && note.day !== fact.day) return false;
  return true;
}

// ── Prices ──────────────────────────────────────────────────────────────────

export type Price = { amount: number; term: string | null; raw: string };

const TERM_WORDS: [RegExp, string][] = [
  [/^(?:year|yr|annum|annual|annually|yearly|12\s+months)$/i, "year"],
  [/^(?:month|mo|monthly)$/i, "month"],
  [/^(?:quarter|quarterly|qtr)$/i, "quarter"],
  [/^(?:week|weekly|wk)$/i, "week"],
  [/^(?:lifetime|life)$/i, "lifetime"],
];

function termOf(word: string | undefined | null): string | null {
  if (!word) return null;
  for (const [re, term] of TERM_WORDS) if (re.test(word.trim())) return term;
  return null;
}

const PRICE_RE = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d,]*\s*(?:k\b|m\b|million|billion|thousand))(?:\s*(?:\/|per|a|an|each)\s*(year|yr|annum|month|mo|quarter|qtr|week|wk|lifetime))?/gi;
const TERM_BEFORE = /\b(annual|annually|yearly|monthly|quarterly|lifetime|one-year|1-year|12-month)\b/i;

/** Dollar prices in a passage with their term ("per year"), when given. */
export function extractPrices(text: string): Price[] {
  const out: Price[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(PRICE_RE.source, "gi");
  while ((match = re.exec(text))) {
    const amount = Number(`${match[1]!.replace(/,/g, "")}.${match[2] ?? "0"}`);
    let term = termOf(match[3]);
    if (!term) {
      const before = text.slice(Math.max(0, match.index - 40), match.index);
      const word = TERM_BEFORE.exec(before)?.[1];
      term = word ? (/one-year|1-year|12-month/i.test(word) ? "year" : termOf(word)) : null;
      if (!term) {
        const after = text.slice(match.index + match[0].length, match.index + match[0].length + 25);
        const follow = /^\s*(?:for\s+(?:a|one|the)\s+)?(year|month|quarter|lifetime)\b/i.exec(after) ?? /^\s*(annually|yearly|monthly|quarterly)\b/i.exec(after);
        term = follow ? termOf(follow[1]) : null;
      }
    }
    out.push({ amount, term, raw: match[0].replace(/\s+$/, "") });
  }
  return out;
}

const PRICE_CUE = /\b(price[sd]?|pricing|costs?|subscription|subscribe|membership|renewal|renews?|offer(?:ed)?|sells?\s+for|sold\s+for|charges?|fee|retail|list\s+price|join|order|per\s+year|a\s+year|per\s+month|a\s+month|annual|monthly|lifetime)\b/i;
const NOT_A_PRICE = /\b(gains?|profits?|returns?|made|turned\s+into|winners?|grew|growth|revenue|sales\s+of|portfolio|account|invested|investing|worth)\b/i;

export type FactPrice = Price & { offer: string };

export function factPrices(offers: string | string[] | undefined): FactPrice[] {
  const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
  return list.flatMap((offer) => {
    const prices = extractPrices(offer);
    const termHint = termOf(/\b(annual|annually|yearly|year|monthly|month|quarterly|quarter|lifetime)\b/i.exec(offer)?.[1]);
    return prices.map((price) => ({ ...price, term: price.term ?? termHint, offer }));
  });
}

// ── Names, titles, assignments ──────────────────────────────────────────────

const PERSON = "([A-Z][a-z'’-]+(?:\\s+[A-Z]\\.)?(?:\\s+(?:de|van|von|da|del|la|le|Mc|O')?\\s*[A-Z][a-z'’-]+){1,2})";
const ROLE_WORD = "(?:editor|strategist|analyst|officer|director|founder|chief|president|publisher|economist|trader|investor|advisor|adviser|manager|partner|specialist|expert|head|writer|columnist|researcher|chair|principal|scientist|physician|doctor|coach|host)";

function personName(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function samePerson(a: string, b: string): boolean {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return false;
  return x === y || x.endsWith(` ${y}`) || y.endsWith(` ${x}`) || x.startsWith(`${y} `) || y.startsWith(`${x} `);
}

function factEditorNames(value: string | string[] | undefined): string[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.map((item) => item.replace(/\s*\([^)]*\)\s*$/, "").trim()).filter(Boolean);
}

function factPublicationRefs(value: string | string[] | undefined): { name: string; code: string }[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.map((item) => {
    const m = /^(.*?)\s*\(([^,)]+)(?:,[^)]*)?\)\s*$/.exec(item);
    return m ? { name: m[1]!.trim(), code: m[2]!.trim() } : { name: item.trim(), code: "" };
  });
}

const PAST = /\b(former(?:ly)?|previously|used\s+to|ex-|until\s+(?:19|20)\d{2}|once|retired\s+from|left)\b/i;

/** People a passage says edit or write a publication. */
export function extractEditorClaims(text: string, opts: { heading?: string | null; listItem?: boolean } = {}): { name: string; raw: string }[] {
  const out: { name: string; raw: string }[] = [];
  const add = (name: string, raw: string) => {
    const clean = personName(name);
    if (!out.some((item) => samePerson(item.name, clean))) out.push({ name: clean, raw: clean });
    void raw;
  };
  const patterns = [
    new RegExp(`\\b(?:edited|written|run|led|authored|helmed|penned|hosted|published)\\s+by\\s+${PERSON}`, "g"),
    new RegExp(`${PERSON}\\s+(?:edits|writes|runs|leads|helms|is\\s+(?:the\\s+|its\\s+)?(?:lead\\s+|chief\\s+|senior\\s+|managing\\s+)?editor(?:\\s+of)?)\\b`, "g"),
    new RegExp(`\\b(?:lead\\s+|chief\\s+|senior\\s+|managing\\s+)?editor\\s*(?::|is|,)\\s*${PERSON}`, "g"),
    new RegExp(`\\b(?:its|the)\\s+(?:lead\\s+|chief\\s+|senior\\s+)?editor,\\s+${PERSON}`, "g"),
  ];
  for (const re of patterns) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) add(match[1]!, match[0]);
  }
  if (opts.listItem && opts.heading && /\beditors?\b|\bwho\s+writes\b|\bwriters?\b/i.test(opts.heading)) {
    const lead = new RegExp(`^${PERSON}(?=\\s*(?:\\(|,|—|–|-|:|$))`).exec(text.trim());
    if (lead) add(lead[1]!, lead[0]);
  }
  return out;
}

/** "Ada Lee, Chief Strategist at …" / "Ada Lee is the senior analyst" → the title. */
export function extractTitles(text: string, name: string): { title: string; raw: string }[] {
  const nameRe = escapeRe(name);
  const titleRe = `((?:[A-Za-z’'&-]+\\s+){0,5}?${ROLE_WORD}[a-z]*(?:\\s+(?:of|for)\\s+[A-Z][\\w’'&-]*(?:\\s+[A-Z][\\w’'&-]*){0,3})?)`;
  const patterns = [
    new RegExp(`${nameRe},\\s+(?:the\\s+|our\\s+|its\\s+|a\\s+|an\\s+)?${titleRe}(?=\\s+(?:at|of|for|with)\\b|\\s*[,.;)]|$)`, "gi"),
    new RegExp(`${nameRe}\\s+(?:is|serves\\s+as|works\\s+as)\\s+(?:the\\s+|our\\s+|its\\s+|a\\s+|an\\s+)${titleRe}(?=\\s+(?:at|of|for|with)\\b|\\s*[,.;)]|$)`, "gi"),
    new RegExp(`\\btitle\\s*:\\s*${titleRe}`, "gi"),
  ];
  const out: { title: string; raw: string }[] = [];
  for (const re of patterns) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      const title = match[1]!.replace(/\s+/g, " ").replace(/\s+(?:of|for)\s+(?:the\s+)?[a-z].*$/, "").trim();
      if (PAST.test(title) || PAST.test(text.slice(Math.max(0, match.index - 20), match.index + match[0].length))) continue;
      if (!out.some((item) => item.title.toLowerCase() === title.toLowerCase())) out.push({ title, raw: title });
    }
  }
  return out;
}

const STOP_TITLE = new Set(["the", "a", "an", "our", "its", "of", "for", "and", "at", "senior", "&"]);

/** Titles agree when one's significant words contain the other's. */
export function titlesAgree(fact: string, note: string): boolean {
  const words = (text: string) => new Set(normalizeName(text).split(" ").filter((w) => w && !STOP_TITLE.has(w)));
  const a = words(fact);
  const b = words(note);
  if (!a.size || !b.size) return true;
  const inter = [...b].filter((w) => a.has(w)).length;
  return inter === b.size || inter === a.size;
}

/** "(CODE)" right after the name, or "code: CODE". */
export function extractCodes(text: string, name: string): { code: string; raw: string }[] {
  const out: { code: string; raw: string }[] = [];
  const patterns = [new RegExp(`${escapeRe(name)}\\s*\\(([A-Z][A-Z0-9-]{1,11})\\)`, "gi"), /\b(?:publication\s+)?code\s*(?::|is|=)\s*["“]?([A-Z][A-Z0-9-]{1,11})\b/g];
  for (const re of patterns) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      const code = match[1]!;
      if (code !== code.toUpperCase()) continue;
      if (!out.some((item) => item.code === code)) out.push({ code, raw: code });
    }
  }
  return out;
}

/** "Some Name (CODE)": the name a note gives a code. */
export function extractNamesForCode(text: string, code: string): { name: string; raw: string }[] {
  const re = new RegExp(`((?:[A-Z][\\w’'&.-]*|of|the|and|&)(?:\\s+(?:[A-Z][\\w’'&.-]*|of|the|and|&)){0,6})\\s*\\(${escapeRe(code)}\\)`, "g");
  const out: { name: string; raw: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const name = match[1]!.replace(/^(?:of|and|&)\s+/i, "").trim();
    if (name && !out.some((item) => item.name === name)) out.push({ name, raw: name });
  }
  return out;
}

function namesAgree(fact: string, note: string): boolean {
  const a = normalizeName(fact);
  const b = normalizeName(note);
  return a === b || b.endsWith(` ${a}`) || a.endsWith(` ${b}`);
}

const DISCONTINUED = /\b(discontinued|retired|shut\s+down|closed\s+down|no\s+longer\s+(?:published|offered|available|sold|running)|ceased\s+(?:publication|publishing)|(?:was|has\s+been)\s+cancel+ed|sunset(?:ted)?|wound\s+down|folded)\b/i;
const EDITOR_LEFT = /\b(left\s+the\s+(?:company|firm|team)|no\s+longer\s+(?:with|writes|edits|at)|departed|stepped\s+down|retired)\b/i;

// ── Statements ──────────────────────────────────────────────────────────────

/** Every statement the notes make about the entity's structured facts, agreeing or not. */
export function extractStatements(entity: ConflictEntity, notes: readonly ConflictNote[]): Statement[] {
  const f = entity.fields;
  const out: Statement[] = [];
  for (const note of notes) {
    for (const passage of splitPassages(note.body)) {
      if (!aboutEntity(passage, entity, note)) continue;
      const named = mentions(passage.text, [entity.name, ...entity.aliases]);
      const boost = named ? 0.1 : 0;
      const push = (s: Omit<Statement, "noteId" | "quote">) => out.push({ ...s, noteId: note.id, quote: passage.text, confidence: Math.min(0.95, s.confidence + (s.agrees ? 0 : boost)) });
      if (entity.kind === "publication") publicationStatements(entity, f, passage, push);
      else editorStatements(entity, f, passage, push);
    }
  }
  return out;
}

type Push = (s: Omit<Statement, "noteId" | "quote">) => void;

function publicationStatements(entity: ConflictEntity, f: FactFields, passage: Passage, push: Push) {
  const text = passage.text;
  // Frequency (the entity's own name is masked: "The Daily Edge" says nothing about frequency)
  const masked = maskNames(text, [entity.name, ...entity.aliases, ...(entity.otherNames ?? [])]);
  const frequency = typeof f.frequency === "string" ? f.frequency : null;
  if (frequency && frequency !== "As needed" && (FREQUENCY_CUE.test(text) || /frequen|schedule/i.test(passage.heading ?? ""))) {
    const found = extractFrequencies(masked);
    if (found.length === 1) {
      const item = found[0]!;
      const agrees = frequencyCompatible(frequency, item.value);
      push({ factKey: "frequency", noteSays: item.raw.toLowerCase() === item.value.toLowerCase() ? item.value.toLowerCase() : `${item.value.toLowerCase()} (“${item.raw}”)`, noteValue: item.raw, suggestedValue: frequency.toLowerCase(), agrees, confidence: 0.7, rule: "frequency" });
    }
  }
  // Launch date
  const launch = typeof f.launchDate === "string" ? parseFactDate(f.launchDate) : null;
  if (launch) {
    for (const date of extractLaunchDates(text)) {
      const agrees = datesAgree(launch, date);
      push({ factKey: "launchDate", noteSays: `launched ${date.raw}`, noteValue: date.raw, suggestedValue: formatDateLike(launch, date), agrees, confidence: 0.75, rule: "launch-date" });
    }
  }
  // Prices
  const facts = factPrices(f.offers);
  const pricing = /price|pricing|offer|cost|subscri/i.test(passage.heading ?? "");
  if (facts.length && (pricing || (PRICE_CUE.test(text) && !NOT_A_PRICE.test(text)))) {
    for (const price of extractPrices(text)) {
      if (facts.some((fp) => Math.abs(fp.amount - price.amount) < 0.005)) {
        push({ factKey: "offers", noteSays: price.raw, noteValue: null, suggestedValue: null, agrees: true, confidence: 0.8, rule: "price" });
        continue;
      }
      const sameTerm = price.term ? facts.filter((fp) => fp.term === price.term) : [];
      const compare = sameTerm.length ? sameTerm : !price.term && facts.length === 1 ? facts : [];
      if (!compare.length) continue;
      const target = compare[0]!;
      push({ factKey: "offers", noteSays: price.raw, noteValue: /\$\s?[\d,]+(?:\.\d{1,2})?/.exec(price.raw)?.[0] ?? price.raw, suggestedValue: /\$\s?[\d,]+(?:\.\d{1,2})?/.exec(target.raw)?.[0] ?? target.raw, agrees: false, confidence: sameTerm.length ? 0.75 : 0.55, rule: "price" });
    }
  }
  // Code and name
  const code = typeof f.code === "string" ? f.code : null;
  if (code) {
    for (const item of extractCodes(text, entity.name)) {
      push({ factKey: "code", noteSays: `code ${item.code}`, noteValue: item.code, suggestedValue: code, agrees: item.code.toUpperCase() === code.toUpperCase(), confidence: 0.8, rule: "code" });
    }
    for (const item of extractNamesForCode(text, code)) {
      push({ factKey: "name", noteSays: `“${item.name}” (${code})`, noteValue: item.name, suggestedValue: entity.name, agrees: namesAgree(entity.name, item.name), confidence: 0.75, rule: "name" });
    }
  }
  // Editors
  const editors = factEditorNames(f.editors);
  if (!PAST.test(text)) {
    const blocked = [entity.name, ...(entity.knownPublications ?? []).map((p) => p.name)];
    for (const claim of extractEditorClaims(text, passage)) {
      if (blocked.some((name) => samePerson(name, claim.name))) continue;
      const agrees = editors.some((name) => samePerson(name, claim.name));
      push({
        factKey: "editors",
        noteSays: `edited by ${claim.name}`,
        noteValue: claim.name,
        suggestedValue: editors[0] ?? null,
        agrees,
        confidence: editors.length ? 0.7 : 0.5,
        rule: "editor",
      });
    }
  }
  // Status
  const status = typeof f.status === "string" ? f.status : null;
  if (status && status !== "retired" && !f.archived) {
    const m = DISCONTINUED.exec(text);
    if (m && !/\b(?:not|never)\s+(?:been\s+)?$/i.test(text.slice(0, m.index))) {
      push({ factKey: "status", noteSays: `says it was ${m[0]}`, noteValue: null, suggestedValue: null, agrees: false, confidence: 0.65, rule: "status" });
    }
  }
}

function editorStatements(entity: ConflictEntity, f: FactFields, passage: Passage, push: Push) {
  const text = passage.text;
  // Title
  const title = typeof f.title === "string" ? f.title : null;
  if (title) {
    for (const item of extractTitles(text, entity.name)) {
      push({ factKey: "title", noteSays: item.title, noteValue: item.raw, suggestedValue: title, agrees: titlesAgree(title, item.title), confidence: 0.6, rule: "title" });
    }
  }
  // Publications
  const factPubs = factPublicationRefs(f.publications);
  const known = entity.knownPublications ?? [];
  if (known.length && !PAST.test(text)) {
    const verbs = "(?:edits|edited|editor\\s+(?:of|at|for)|writes(?:\\s+for)?|runs|leads|helms|authors?|author\\s+of|behind|is\\s+the\\s+(?:lead\\s+|chief\\s+|senior\\s+)?editor\\s+(?:of|at|for))";
    for (const pub of known) {
      const names = [pub.name, pub.code].filter((n) => n && n.length >= 2);
      const pubRe = names.map(escapeRe).join("|");
      const forward = new RegExp(`\\b${verbs}\\b[^.;\\n]{0,40}?(?<![\\p{L}\\p{N}])(${pubRe})(?![\\p{L}\\p{N}])`, "iu");
      const backward = new RegExp(`(?<![\\p{L}\\p{N}])(${pubRe})(?![\\p{L}\\p{N}])[^.;\\n]{0,30}?\\b(?:is\\s+)?(?:edited|written|run|led|helmed)\\s+by\\b`, "iu");
      const match = forward.exec(text) ?? backward.exec(text);
      if (!match) continue;
      const agrees = factPubs.some((fp) => namesAgree(fp.name, pub.name) || (fp.code && fp.code.toUpperCase() === pub.code.toUpperCase()));
      push({ factKey: "publications", noteSays: `writes for ${pub.name}`, noteValue: null, suggestedValue: null, agrees, confidence: factPubs.length ? 0.7 : 0.5, rule: "editor-publication" });
    }
  }
  // Status
  if (f.status === "active" && !f.archived) {
    const m = EDITOR_LEFT.exec(text);
    if (m) push({ factKey: "status", noteSays: `says they ${m[0]}`, noteValue: null, suggestedValue: null, agrees: false, confidence: 0.6, rule: "status" });
  }
}

/** The rule layer: one candidate per (fact, note), the most confident disagreeing statement. */
export function detectRuleConflicts(entity: ConflictEntity, notes: readonly ConflictNote[]): ConflictCandidate[] {
  const best = new Map<string, ConflictCandidate>();
  for (const s of extractStatements(entity, notes)) {
    if (s.agrees) continue;
    const key = `${s.factKey}|${s.noteId}`;
    const current = best.get(key);
    if (current && current.confidence >= s.confidence) continue;
    best.set(key, {
      factKey: s.factKey,
      factValue: factText(entity.fields[s.factKey]) || "(not set in Publication Setup)",
      noteId: s.noteId,
      noteSays: s.noteSays,
      quote: s.quote,
      noteValue: s.noteValue,
      suggestedValue: s.suggestedValue,
      confidence: Math.round(s.confidence * 100) / 100,
      layer: "rule",
      rule: s.rule,
    });
  }
  return [...best.values()];
}

// ── Quotes and passage edits ────────────────────────────────────────────────

/** Where a quote sits in the body (whitespace-insensitive; then case-insensitive). */
export function locateQuote(body: string, quote: string): { start: number; end: number } | null {
  const q = quote.replace(/\s+/g, " ").trim();
  if (!q) return null;
  const map: number[] = [];
  let norm = "";
  let lastSpace = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (/\s/.test(ch)) {
      if (lastSpace) continue;
      norm += " ";
      map.push(i);
      lastSpace = true;
    } else {
      norm += ch;
      map.push(i);
      lastSpace = false;
    }
  }
  let at = norm.indexOf(q);
  if (at < 0) at = norm.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return null;
  const start = map[at]!;
  const end = map[at + q.length - 1]! + 1;
  return { start, end };
}

/** Replace one passage of a note. Null when the passage is no longer in the note. */
export function replacePassage(body: string, quote: string, replacement: string): string | null {
  const where = locateQuote(body, quote);
  if (!where) return null;
  return body.slice(0, where.start) + replacement + body.slice(where.end);
}

/** The passage with the disagreeing token swapped for the Setup value (a starting point a person confirms). */
export function suggestPassageFix(quote: string, noteValue: string | null, suggestedValue: string | null): string {
  if (!noteValue || !suggestedValue) return quote;
  const at = quote.indexOf(noteValue);
  if (at < 0) return quote;
  return quote.slice(0, at) + suggestedValue + quote.slice(at + noteValue.length);
}

// ── Reconcile a new check with stored conflicts ─────────────────────────────

export type StoredConflict = {
  id: string;
  factKey: string;
  noteId: string;
  layer: "rule" | "ai";
  status: "OPEN" | "RESOLVED" | "DISMISSED";
  resolution: string | null;
  factHash: string;
  noteHash: string;
};

export type ReconcilePlan = {
  create: (ConflictCandidate & { factHash: string; noteHash: string })[];
  refresh: { id: string; candidate: ConflictCandidate; factHash: string; noteHash: string; clearResolution: boolean }[];
  reopen: { id: string; candidate: ConflictCandidate; factHash: string; noteHash: string }[];
  /** Still dismissed (or resolved): same fact and same note text as when a person decided. */
  suppressed: string[];
  /** Open before, not found now. */
  cleared: string[];
};

/**
 * One conflict per (fact, note). A dismissed or resolved conflict comes back only
 * when the fact or the note changed since. An open one that is no longer found is
 * cleared, but only by a layer that actually ran this time (an AI conflict is not
 * cleared because the AI was unavailable).
 */
export function reconcileConflicts(input: {
  existing: readonly StoredConflict[];
  candidates: readonly ConflictCandidate[];
  factHashes: Record<string, string>;
  noteHashes: Record<string, string>;
  layersRun: readonly ("rule" | "ai")[];
}): ReconcilePlan {
  const plan: ReconcilePlan = { create: [], refresh: [], reopen: [], suppressed: [], cleared: [] };
  const byKey = new Map(input.existing.map((row) => [`${row.factKey}|${row.noteId}`, row]));
  const seen = new Set<string>();
  const ranked = [...input.candidates].sort((a, b) => (a.layer === b.layer ? b.confidence - a.confidence : a.layer === "rule" ? -1 : 1));
  for (const candidate of ranked) {
    const key = `${candidate.factKey}|${candidate.noteId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const fh = input.factHashes[candidate.factKey] ?? factHash(candidate.factKey, undefined);
    const nh = input.noteHashes[candidate.noteId] ?? "";
    const row = byKey.get(key);
    if (!row) {
      plan.create.push({ ...candidate, factHash: fh, noteHash: nh });
      continue;
    }
    if (row.status === "OPEN") {
      plan.refresh.push({ id: row.id, candidate, factHash: fh, noteHash: nh, clearResolution: row.factHash !== fh || row.noteHash !== nh });
      continue;
    }
    // Only a person's decision is sticky: a conflict the re-check itself cleared comes back as soon as it is found again.
    if (row.resolution !== "cleared" && row.factHash === fh && row.noteHash === nh) plan.suppressed.push(row.id);
    else plan.reopen.push({ id: row.id, candidate, factHash: fh, noteHash: nh });
  }
  for (const row of input.existing) {
    if (row.status !== "OPEN" || seen.has(`${row.factKey}|${row.noteId}`)) continue;
    if (input.layersRun.includes(row.layer) || !(row.noteId in input.noteHashes)) plan.cleared.push(row.id);
  }
  return plan;
}

// ── AI layer ────────────────────────────────────────────────────────────────

export const CONFLICT_SYSTEM = `You review a company's knowledge base for contradictions.
You get the official facts about one publication or editor, entered by the publisher in its setup screen. These facts are the source of truth.
You also get notes from the knowledge base that mention it. Find statements in the notes that contradict an official fact.

Rules:
- Report only real contradictions of a listed fact: a different price, frequency, date, name, code, title, editor or publication, or a status that cannot both be true.
- Do not report missing information, extra detail the facts do not cover, opinions, promotional language, or statements about a different publication or person.
- Do not report a statement that is clearly about the past ("formerly", "used to") unless the fact is about that same past event.
- "quote" must be copied exactly, character for character, from the note: one sentence or list item, no more than 300 characters.
- "noteSays" restates the note's claim in a few words. "factKey" is the key of the contradicted fact exactly as given.
- "confidence" is 0 to 1: how sure you are that the two cannot both be true.
- Return an empty list when nothing contradicts. Never invent facts.`;

export const CONFLICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["conflicts"],
  properties: {
    conflicts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["factKey", "noteId", "noteSays", "quote", "confidence"],
        properties: {
          factKey: { type: "string" },
          noteId: { type: "string" },
          noteSays: { type: "string" },
          quote: { type: "string" },
          confidence: { type: "number" },
        },
      },
    },
  },
} as const;

export type AiConflictRaw = { conflicts: { factKey: string; noteId: string; noteSays: string; quote: string; confidence: number }[] };

export const AI_NOTE_LIMIT = 6;
const AI_NOTE_CHARS = 6000;

export function conflictPrompt(entity: ConflictEntity, notes: readonly ConflictNote[]): string {
  const facts = Object.entries(entity.fields)
    .filter(([key]) => key !== "archived" || entity.fields.archived)
    .map(([key, value]) => `- ${key} (${factLabel(key)}): ${factText(value)}`)
    .join("\n");
  const blocks = notes
    .slice(0, AI_NOTE_LIMIT)
    .map((note) => `<note id="${note.id}" title="${note.title.replace(/"/g, "'")}">\n${note.body.slice(0, AI_NOTE_CHARS)}\n</note>`)
    .join("\n\n");
  return [
    `<entity kind="${entity.kind}" name="${entity.name.replace(/"/g, "'")}"${entity.aliases.length ? ` also_called="${entity.aliases.join(", ")}"` : ""}>`,
    `Official facts (source of truth):`,
    facts,
    `</entity>`,
    "",
    blocks,
    "",
    "List every statement in these notes that contradicts one of the official facts.",
  ].join("\n");
}

/** Keep only AI conflicts whose fact exists, whose note was sent, and whose quote is really in that note. */
export function normalizeAiConflicts(raw: AiConflictRaw | null | undefined, entity: ConflictEntity, notes: readonly ConflictNote[]): ConflictCandidate[] {
  const byId = new Map(notes.map((note) => [note.id, note]));
  const out: ConflictCandidate[] = [];
  for (const item of raw?.conflicts ?? []) {
    const note = byId.get(String(item.noteId));
    if (!note) continue;
    const key = String(item.factKey);
    if (!(key in entity.fields)) continue;
    const quote = String(item.quote ?? "").trim().slice(0, 400);
    const where = quote ? locateQuote(note.body, quote) : null;
    if (!where) continue;
    const confidence = Math.max(0, Math.min(1, Number(item.confidence) || 0));
    if (confidence < 0.5) continue;
    out.push({
      factKey: key,
      factValue: factText(entity.fields[key]),
      noteId: note.id,
      noteSays: String(item.noteSays ?? "").trim().slice(0, 300) || "contradicts this fact",
      quote: note.body.slice(where.start, where.end),
      noteValue: null,
      suggestedValue: null,
      confidence: Math.round(confidence * 100) / 100,
      layer: "ai",
      rule: null,
    });
  }
  return out;
}

export const REWRITE_SYSTEM = `You correct one note in a company's knowledge base.
You get the note, one passage in it that contradicts an official fact, and that fact (the source of truth).
Return the whole note with that contradiction corrected to match the fact.
Change as little as possible: keep every other sentence, the Markdown, links and headings exactly as they are. Do not add new claims.`;

export const REWRITE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["body", "summary"],
  properties: { body: { type: "string" }, summary: { type: "string" } },
} as const;

export function rewritePrompt(input: { title: string; body: string; quote: string; factLabel: string; factValue: string; noteSays: string }): string {
  return [
    `<fact name="${input.factLabel}">${input.factValue}</fact>`,
    `<contradiction>${input.noteSays}</contradiction>`,
    `<passage>${input.quote}</passage>`,
    `<note title="${input.title.replace(/"/g, "'")}">`,
    input.body,
    `</note>`,
    "",
    "Return the corrected note body and a one-line summary of what you changed.",
  ].join("\n");
}
