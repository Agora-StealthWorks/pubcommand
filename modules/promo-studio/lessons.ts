/**
 * Lessons Learned: the brand-level knowledge base. Raw lessons come from every
 * analysis (its `lessons`) and, for promos with real results, from what the
 * analysis praised or flagged in top and bottom performers. The AI groups
 * them into themes; counts and example promos are computed here from the ids
 * it returns, never taken from the AI.
 */

export const LESSON_CATEGORIES = ["hook", "headline", "proof", "offer", "structure", "voice", "audience", "close", "compliance", "other"] as const;
export type LessonCategory = (typeof LESSON_CATEGORIES)[number];

export type LessonSourcePromo = {
  id: string;
  title: string;
  promoType: string | null;
  lessons: string[];
  strengths: string[];
  fixes: string[];
  /** Percentile within the promo's type cohort, when real results exist. */
  percentile: number | null;
  tierLabel: string | null;
};

export type LessonItem = { id: string; promoId: string; text: string; fromResults: boolean };

/** Max items sent to the AI in one run; newest promos come first. */
export const MAX_LESSON_ITEMS = 400;

const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Flatten promos into numbered lesson items. Exact duplicates (ignoring case
 * and punctuation) from different promos collapse to one item per promo so
 * the count stays honest. Results-backed items: what worked in the top
 * quarter of a cohort, what needed fixing in the bottom quarter.
 */
export function buildLessonItems(promos: readonly LessonSourcePromo[], max = MAX_LESSON_ITEMS): LessonItem[] {
  const items: LessonItem[] = [];
  const seen = new Set<string>();
  const push = (promoId: string, raw: string, fromResults: boolean) => {
    const text = raw.trim().replace(/\s+/g, " ").slice(0, 320);
    const key = `${promoId}:${squash(text)}`;
    if (text.length < 12 || seen.has(key) || items.length >= max) return;
    seen.add(key);
    items.push({ id: `L${items.length + 1}`, promoId, text, fromResults });
  };
  for (const promo of promos) {
    for (const lesson of promo.lessons) push(promo.id, lesson, false);
    if (promo.percentile != null && promo.percentile >= 0.75) {
      for (const strength of promo.strengths.slice(0, 3)) push(promo.id, `Worked in a top-quarter ${promo.promoType ?? ""} promo: ${strength}`, true);
    }
    if (promo.percentile != null && promo.percentile < 0.25) {
      for (const fix of promo.fixes.slice(0, 3)) push(promo.id, `Weakness in a bottom-quarter ${promo.promoType ?? ""} promo: ${fix}`, true);
    }
  }
  return items;
}

export type ExistingTheme = { title: string; body: string };

export function lessonPrompt(input: { brandContext: string; items: readonly LessonItem[]; existing: readonly ExistingTheme[] }): string {
  const existing = input.existing.length
    ? `\n\nThemes a person already kept. Reuse a title exactly when items belong to it:\n${input.existing.map((t) => `- ${t.title}: ${t.body.slice(0, 200)}`).join("\n")}`
    : "";
  return `${input.brandContext}${existing}\n\nLesson items (id: text):\n${input.items.map((item) => `${item.id}: ${item.text}`).join("\n")}`;
}

export const LESSON_SYSTEM = `You organize a publisher's copywriting lessons into a short knowledge base.

You get numbered lesson items taken from reviews of the publisher's own sales promos. Some are marked as coming from promos that did well or badly in real results.

Group items that teach the same idea into one theme. For each theme:
- title: a short name for the idea (at most 8 words).
- lesson: one to three plain sentences stating the lesson so it makes sense on its own. Do not quote numbers, prices or results; the items do not give you any.
- category: the closest category.
- itemIds: every item id that belongs to the theme. Use only ids from the list. An item belongs to one theme at most.
- generic: true only when the lesson is a general copywriting best practice that would hold for any publisher, with no brand, product, person or niche-specific claim in it.

Skip items that are too vague to teach anything. Give between 5 and 30 themes, the best-supported first.`;

export const LESSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["themes"],
  properties: {
    themes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "lesson", "category", "itemIds", "generic"],
        properties: {
          title: { type: "string" },
          lesson: { type: "string" },
          category: { type: "string", enum: [...LESSON_CATEGORIES] },
          itemIds: { type: "array", items: { type: "string" } },
          generic: { type: "boolean" },
        },
      },
    },
  },
};

export type LessonAnswer = { themes: { title: string; lesson: string; category: string; itemIds: string[]; generic: boolean }[] };

export type ClusteredTheme = {
  title: string;
  body: string;
  category: LessonCategory;
  promoIds: string[];
  evidenceCount: number;
  fromResults: boolean;
  suggestedShared: boolean;
};

/**
 * Turn the AI's answer into stored themes. Unknown ids are dropped, an item
 * claimed twice counts for the first theme only, and the count is distinct
 * promos. Themes left with no evidence are dropped. Same-title themes merge.
 */
export function applyClusters(answer: LessonAnswer, items: readonly LessonItem[]): ClusteredTheme[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const claimed = new Set<string>();
  const merged = new Map<string, ClusteredTheme>();
  for (const theme of answer.themes) {
    const own = theme.itemIds.filter((id) => byId.has(id) && !claimed.has(id));
    own.forEach((id) => claimed.add(id));
    const title = theme.title.trim().slice(0, 120);
    if (!own.length || !title) continue;
    const key = squash(title);
    const current = merged.get(key) ?? {
      title,
      body: theme.lesson.trim().slice(0, 1200),
      category: (LESSON_CATEGORIES as readonly string[]).includes(theme.category) ? (theme.category as LessonCategory) : "other",
      promoIds: [],
      evidenceCount: 0,
      fromResults: false,
      suggestedShared: theme.generic,
    };
    for (const id of own) {
      const item = byId.get(id)!;
      if (!current.promoIds.includes(item.promoId)) current.promoIds.push(item.promoId);
      if (item.fromResults) current.fromResults = true;
    }
    current.evidenceCount = current.promoIds.length;
    current.suggestedShared = current.suggestedShared && theme.generic;
    merged.set(key, current);
  }
  return [...merged.values()].sort((a, b) => b.evidenceCount - a.evidenceCount);
}

export function sameTheme(a: string, b: string): boolean {
  return squash(a) === squash(b);
}

/** The brand Brain note listing the visible themes. */
export function lessonsBrainNote(brandName: string, themes: readonly { title: string; body: string; evidenceCount: number; pinned: boolean }[]): { title: string; body: string } {
  const lines = [`# Lessons learned: ${brandName}`, "", "Themes from this brand's promo reviews and real results. Count = promos behind the lesson.", ""];
  for (const theme of themes) lines.push(`- **${theme.title}**${theme.pinned ? " (pinned)" : ""} — ${theme.body} _(${theme.evidenceCount} promo${theme.evidenceCount === 1 ? "" : "s"})_`);
  return { title: `Lessons learned: ${brandName}`, body: lines.join("\n") };
}
