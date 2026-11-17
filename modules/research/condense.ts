/**
 * Condense: shorten a set of index cards into fewer, denser cards. Each new
 * card says which originals it merges, and its key points must be copied from
 * those originals (anything else is dropped), so condensing never adds facts.
 */

import { CARD_TYPES, KEY_POINT_KINDS, normalizeTags, type CardType, type KeyPoint } from "./extract";

export const CONDENSE_MIN_CARDS = 3;
export const CONDENSE_MAX_INPUT = 80;

export type CondenseInputCard = { id: string; topic: string; summary: string; details: string; cardType: string; keyPoints: KeyPoint[]; tags: string[]; sourceLabel: string; sourceUrl: string | null; groupName: string | null };

export type CondenseAnswer = {
  cards: { topic: string; summary: string; details: string; cardType: string; tags: string[]; from: number[]; keyPoints: { text: string; kind: string; location: string }[] }[];
};

export const CONDENSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["cards"],
  properties: {
    cards: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["topic", "summary", "details", "cardType", "tags", "from", "keyPoints"],
        properties: {
          topic: { type: "string" },
          summary: { type: "string" },
          details: { type: "string" },
          cardType: { type: "string", enum: [...CARD_TYPES] },
          tags: { type: "array", items: { type: "string" } },
          from: { type: "array", items: { type: "integer" } },
          keyPoints: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["text", "kind", "location"],
              properties: { text: { type: "string" }, kind: { type: "string", enum: [...KEY_POINT_KINDS] }, location: { type: "string" } },
            },
          },
        },
      },
    },
  },
} as const;

export const CONDENSE_SYSTEM = `You help a copywriter tighten a pile of research index cards. Merge cards that cover the same idea, fold thin cards into the card they support, and drop repetition, so the writer ends up with fewer, denser cards that still hold every important fact.

Rules:
- Work only from the cards given. Add no outside knowledge, figures, names or quotes.
- Every new card lists in "from" the numbers of the original cards it combines. Every original card should end up in exactly one new card unless it adds nothing at all.
- keyPoints: copy the original cards' key points word for word (with their kind and location). Never reword a figure or a quotation.
- topic: a specific 3 to 10 word headline. summary: 2 to 4 plain sentences. details: one paragraph with context and caveats, or empty.
- Keep attributions ("the report says") as the originals have them.`;

export function condensePrompt(input: { brandContext: string; projectName: string; cards: readonly CondenseInputCard[]; target: number }): string {
  const list = input.cards
    .map((card, index) => {
      const points = card.keyPoints.map((p) => `    - (${p.kind}) ${p.text}${p.location ? ` [${p.location}]` : ""}`).join("\n");
      return `${index + 1}. ${card.topic} (${card.cardType}; source: ${card.sourceLabel || "unknown"})\n   ${card.summary}${card.details ? `\n   Details: ${card.details}` : ""}${points ? `\n   Key points:\n${points}` : ""}`;
    })
    .join("\n\n");
  return `${input.brandContext}\n\nResearch project: ${input.projectName}\n\n<cards>\n${list}\n</cards>\n\nCondense these ${input.cards.length} cards into about ${input.target} cards.`;
}

/** Aim for roughly half as many cards, never fewer than two. */
export function condenseTarget(count: number, requested?: number | null): number {
  const fallback = Math.max(2, Math.round(count / 2));
  if (!requested || !Number.isFinite(requested)) return fallback;
  return Math.min(count - 1, Math.max(1, Math.round(requested)));
}

const keyOf = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
const str = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

export type CondensedCard = {
  topic: string;
  summary: string;
  details: string;
  cardType: CardType;
  tags: string[];
  keyPoints: KeyPoint[];
  /** Ids of the original cards merged into this one. */
  fromIds: string[];
  sourceLabel: string;
  sourceUrl: string | null;
  groupName: string | null;
};

export type CondensePlan = { cards: CondensedCard[]; problem: string | null };

/**
 * Check the answer against the originals: indexes must be real, key points
 * must be copied from the cards they came from, and the result must be shorter.
 */
export function planCondense(originals: readonly CondenseInputCard[], raw: unknown): CondensePlan {
  const answer = raw && typeof raw === "object" && Array.isArray((raw as CondenseAnswer).cards) ? (raw as CondenseAnswer).cards : [];
  const cards: CondensedCard[] = [];
  const claimed = new Set<number>();
  for (const item of answer) {
    const indexes = [...new Set((Array.isArray(item?.from) ? item.from : []).map(Number))]
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= originals.length && !claimed.has(n))
      .sort((a, b) => a - b);
    const topic = str(item?.topic, 200);
    const summary = str(item?.summary, 2000);
    if (!indexes.length || !topic || !summary) continue;
    indexes.forEach((n) => claimed.add(n));
    const sources = indexes.map((n) => originals[n - 1]!);
    const allowed = new Map<string, KeyPoint>();
    for (const card of sources) for (const point of card.keyPoints) allowed.set(keyOf(point.text), point);
    const keyPoints: KeyPoint[] = [];
    const seen = new Set<string>();
    for (const point of Array.isArray(item.keyPoints) ? item.keyPoints : []) {
      const original = allowed.get(keyOf(str(point?.text, 1200)));
      if (!original || seen.has(keyOf(original.text))) continue;
      seen.add(keyOf(original.text));
      keyPoints.push(original);
    }
    const labels = [...new Set(sources.map((card) => card.sourceLabel).filter(Boolean))];
    const urls = [...new Set(sources.map((card) => card.sourceUrl).filter((url): url is string => Boolean(url)))];
    const groups = [...new Set(sources.map((card) => card.groupName).filter((g): g is string => Boolean(g)))];
    cards.push({
      topic,
      summary,
      details: str(item.details, 6000),
      cardType: (CARD_TYPES as readonly string[]).includes(item.cardType) ? (item.cardType as CardType) : "other",
      tags: normalizeTags([...(Array.isArray(item.tags) ? item.tags : []), ...sources.flatMap((card) => card.tags)]),
      keyPoints: keyPoints.slice(0, 12),
      fromIds: sources.map((card) => card.id),
      sourceLabel: (labels.length > 1 ? `${labels[0]} + ${labels.length - 1} more` : (labels[0] ?? "")).slice(0, 200),
      sourceUrl: urls.length === 1 ? urls[0]! : null,
      groupName: groups.length === 1 ? groups[0]! : null,
    });
  }
  if (!cards.length) return { cards, problem: "The AI did not return any usable cards." };
  if (cards.length >= originals.length) return { cards, problem: "The AI did not make the set any shorter, so nothing was changed." };
  return { cards, problem: null };
}

/**
 * When the originals are replaced, every outline link moves to the new card
 * that absorbed it (once per bullet), so the outline keeps its research.
 */
export function relinkPlan(cards: readonly { newId: string; fromIds: readonly string[] }[], links: readonly { bulletId: string; cardId: string; position: number }[]) {
  const into = new Map<string, string>();
  for (const card of cards) for (const id of card.fromIds) into.set(id, card.newId);
  const out: { bulletId: string; cardId: string; position: number }[] = [];
  const seen = new Set<string>();
  for (const link of [...links].sort((a, b) => a.position - b.position)) {
    const target = into.get(link.cardId);
    if (!target) continue;
    const key = `${link.bulletId}:${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ bulletId: link.bulletId, cardId: target, position: link.position });
  }
  return out;
}
