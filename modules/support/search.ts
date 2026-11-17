/** Query words for full-text search: lowercased, deduped, stop words and short words dropped. */
const STOP = new Set(
  "the and for what did does about with that this have you your was are how when can say said tell who why which there their them they from into get got know where will would could should please want need its our out any all".split(" "),
);

export function searchWords(query: string, max = 12): string[] {
  return [
    ...new Set(
      (query ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOP.has(w)),
    ),
  ].slice(0, max);
}

/** Idf weight of a word that appears in df of n passages. */
export function idf(n: number, df: number): number {
  return df > 0 ? Math.log((n + 1) / df) : 0;
}

/** "How do I join / sign up" questions: the pricing and how-to-join record should rank first. */
export function joinIntent(query: string): boolean {
  return /\b(join|sign(ing)?\s?up|subscrib\w*|order|buy|purchase|enroll|register|price|cost)\b/i.test(query);
}
