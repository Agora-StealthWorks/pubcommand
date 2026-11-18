/**
 * The analysis is one streamed text answer split into labelled sections, in a
 * fixed order. Each section opens with a line `<<KEY>>` and closes with
 * `<</KEY>>`. This file knows the order, the labels, and how to cut a full or
 * half-written answer into sections. Pure, so the server (saving) and the
 * browser (live view) cut the same text the same way.
 */

export const SECTION_KEYS = ["HEADLINE", "OUTLINE", "SIXTEEN_WORD", "CUB", "OFFER", "TEASE", "INTEL", "SCORECARD"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export const SECTION_LABELS: Record<SectionKey, string> = {
  HEADLINE: "Headline",
  OUTLINE: "Outline",
  SIXTEEN_WORD: "16-Word Sales Letter",
  CUB: "CUB review",
  OFFER: "Offer summary",
  TEASE: "Tease",
  INTEL: "Promo facts",
  SCORECARD: "Score",
};

export type SectionText = { text: string; complete: boolean };
export type SplitSections = Partial<Record<SectionKey, SectionText>>;

// Tolerant: "<<HEADLINE>>", "<< headline >>", "**<<HEADLINE>>**", "<</HEADLINE>>", "<< /HEADLINE >>".
const MARKER = /^[ \t*_`]*<<\s*(\/?)\s*([A-Za-z_ -]+?)\s*>>[ \t*_`]*$/gm;

function keyFor(name: string): SectionKey | null {
  const key = name.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if ((SECTION_KEYS as readonly string[]).includes(key)) return key as SectionKey;
  if (key === "SIXTEEN_WORD_SALES_LETTER" || key === "16_WORD") return "SIXTEEN_WORD";
  if (key === "EFFECTIVENESS" || key === "SCORE") return "SCORECARD";
  if (key === "PROMO_INTEL") return "INTEL";
  return null;
}

/**
 * Cut the answer into sections. A section is complete when it was closed, or
 * when another section opened after it (the AI forgot a closing line). The
 * last open section of an unfinished answer is incomplete. A section that
 * appears twice keeps its first complete copy.
 */
export function splitSections(raw: string, finished = false): SplitSections {
  const out: SplitSections = {};
  const marks: { key: SectionKey; close: boolean; start: number; end: number }[] = [];
  for (const m of raw.matchAll(MARKER)) {
    const key = keyFor(m[2]!);
    if (key) marks.push({ key, close: m[1] === "/", start: m.index!, end: m.index! + m[0].length });
  }
  let open: { key: SectionKey; from: number } | null = null;
  const commit = (key: SectionKey, text: string, complete: boolean) => {
    const existing = out[key];
    if (existing?.complete) return;
    out[key] = { text: text.trim(), complete };
  };
  for (const mark of marks) {
    if (mark.close) {
      if (open && open.key === mark.key) {
        commit(open.key, raw.slice(open.from, mark.start), true);
        open = null;
      }
      continue;
    }
    if (open) commit(open.key, raw.slice(open.from, mark.start), true);
    open = { key: mark.key, from: mark.end };
  }
  if (open) {
    // A trailing partial closing marker ("<</HEAD") is not content.
    const tail = raw.slice(open.from).replace(/<<\/?[A-Za-z_ -]*$/, "");
    commit(open.key, tail, finished && Boolean(tail.trim()) ? true : false);
  }
  return out;
}

/** The section the AI is writing now (for the live view), or null before the first and after the last. */
export function activeSection(sections: SplitSections): SectionKey | null {
  for (const key of SECTION_KEYS) {
    const s = sections[key];
    if (s && !s.complete) return key;
  }
  return null;
}

/** Share of the eight sections finished, 0-100. */
export function progressPercent(sections: SplitSections): number {
  const done = SECTION_KEYS.filter((key) => sections[key]?.complete).length;
  return Math.round((done / SECTION_KEYS.length) * 100);
}

/** Section text only, for storage. */
export function sectionTexts(sections: SplitSections): Partial<Record<SectionKey, string>> {
  const out: Partial<Record<SectionKey, string>> = {};
  for (const key of SECTION_KEYS) if (sections[key]) out[key] = sections[key]!.text;
  return out;
}
