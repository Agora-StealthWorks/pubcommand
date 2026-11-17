/**
 * Research Extractor: the card-extraction and grouping instructions, their
 * JSON answer shapes, and the clean-up we apply to what comes back. Pure, so it
 * is unit tested without the AI or a database.
 */

export const CARD_TYPES = ["fact", "stat", "quote", "story", "angle", "other"] as const;
export type CardType = (typeof CARD_TYPES)[number];
export const CARD_TYPE_LABELS: Record<CardType, string> = {
  fact: "Fact",
  stat: "Stat",
  quote: "Quote",
  story: "Story",
  angle: "Angle",
  other: "Note",
};

export const KEY_POINT_KINDS = ["fact", "stat", "quote"] as const;
export type KeyPointKind = (typeof KEY_POINT_KINDS)[number];
export type KeyPoint = { text: string; kind: KeyPointKind; location: string };

export const MIN_CARDS = 5;
export const MAX_CARDS = 15;
export const MAX_TAGS = 6;

export type ExtractedCard = {
  topic: string;
  summary: string;
  details: string;
  cardType: CardType;
  keyPoints: KeyPoint[];
  tags: string[];
};

export type ExtractionResult = {
  sourceTitle: string;
  sourceSummary: string;
  cards: ExtractedCard[];
};

const stringArray = { type: "array", items: { type: "string" } } as const;

export const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["sourceTitle", "sourceSummary", "cards"],
  properties: {
    sourceTitle: { type: "string", description: "The source's own title, or a short plain label if it has none." },
    sourceSummary: { type: "string", description: "Two to four sentences on what the whole source covers." },
    cards: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["topic", "summary", "details", "cardType", "keyPoints", "tags"],
        properties: {
          topic: { type: "string" },
          summary: { type: "string" },
          details: { type: "string" },
          cardType: { type: "string", enum: [...CARD_TYPES] },
          keyPoints: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["text", "kind", "location"],
              properties: {
                text: { type: "string" },
                kind: { type: "string", enum: [...KEY_POINT_KINDS] },
                location: { type: "string" },
              },
            },
          },
          tags: stringArray,
        },
      },
    },
  },
} as const;

export const EXTRACTION_SYSTEM = `You help a copywriter organize research with the index-card method. One idea goes on one card. Later the writer sorts the cards into piles and arranges them into an outline, so every card has to stand on its own.

From the source you are given, write between ${MIN_CARDS} and ${MAX_CARDS} cards. Write fewer only when the source is genuinely thin; never pad. Choose the ideas a writer would actually build a piece around: surprising findings, hard numbers, strong quotes, short stories and examples, causes and consequences, and the angles the source suggests.

For each card:
- topic: a specific headline of 3 to 10 words that names the idea, not a vague label.
- summary: 2 to 4 plain sentences, in your own words, that a writer could work from without reopening the source.
- details: one fuller paragraph with the context, the reasoning and any caveats the source gives. Leave it empty if the summary already covers everything.
- cardType: fact, stat, quote, story, angle (an argument or framing the source makes) or other.
- keyPoints: the exact facts, figures and quotations behind the card, copied word for word from the source. Mark each as fact, stat or quote, and give its location in the source: a page number, section heading, paragraph number or [m:ss] timestamp if the source shows one, otherwise a few words describing where it appears. Never invent or round a figure, a date, a name or a quotation. If the source gives no exact wording for something, leave it out.
- tags: 1 to 4 short lowercase tags (people, companies, themes) that help the writer find the card later.

Rules:
- Use only what is in the source. Do not add outside knowledge, predictions or advice. If the source makes a claim, attribute it ("the author argues", "the report says") rather than stating it as true.
- Keep the source's meaning. Note when a figure is an estimate, a forecast or disputed.
- Do not write marketing copy, headlines for ads, or a draft of anything. You are organizing research, not writing the piece.
- The brand context tells you who the writer's readers are, so you can judge which ideas matter to them. It never changes what the source says.`;

export function extractionPrompt(input: {
  brandContext: string;
  projectName: string;
  projectBrief: string;
  sourceTitle: string;
  sourceKind: string;
  text: string | null;
}): string {
  return [
    input.brandContext,
    "",
    `Research project: ${input.projectName}`,
    input.projectBrief ? `What the writer is researching: ${input.projectBrief}` : "",
    `Source (${input.sourceKind}): ${input.sourceTitle}`,
    "",
    input.text ? `<source>\n${input.text}\n</source>` : "The source is the attached PDF.",
    "",
    "Write the index cards for this source.",
  ]
    .filter((line, index, all) => line !== "" || all[index - 1] !== "")
    .join("\n");
}

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const clean = str(tag, 40).toLowerCase().replace(/^#/, "").replace(/\s+/g, " ");
    if (clean) seen.add(clean);
    if (seen.size >= MAX_TAGS) break;
  }
  return [...seen];
}

export function normalizeKeyPoints(points: unknown): KeyPoint[] {
  if (!Array.isArray(points)) return [];
  return points
    .map((point) => {
      const row = (point ?? {}) as Record<string, unknown>;
      const kind = (KEY_POINT_KINDS as readonly string[]).includes(row.kind as string) ? (row.kind as KeyPointKind) : "fact";
      return { text: str(row.text, 1200), kind, location: str(row.location, 120) };
    })
    .filter((point) => point.text)
    .slice(0, 12);
}

/** Clean the AI answer: trim fields, drop empty cards, cap the count, dedupe topics. */
export function normalizeExtraction(raw: unknown): ExtractionResult {
  const data = (raw ?? {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const cards: ExtractedCard[] = [];
  for (const item of Array.isArray(data.cards) ? data.cards : []) {
    const row = (item ?? {}) as Record<string, unknown>;
    const topic = str(row.topic, 200);
    const summary = str(row.summary, 2000);
    if (!topic || !summary) continue;
    const key = topic.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push({
      topic,
      summary,
      details: str(row.details, 6000),
      cardType: (CARD_TYPES as readonly string[]).includes(row.cardType as string) ? (row.cardType as CardType) : "other",
      keyPoints: normalizeKeyPoints(row.keyPoints),
      tags: normalizeTags(row.tags),
    });
    if (cards.length >= MAX_CARDS) break;
  }
  return { sourceTitle: str(data.sourceTitle, 200), sourceSummary: str(data.sourceSummary, 2000), cards };
}

/** Why a finished-but-unusable answer is reported to the writer, or null if it is fine. */
export function extractionProblem(result: ExtractionResult): string | null {
  if (result.cards.length === 0) return "The AI did not find anything to put on a card. Check that the source has readable text.";
  return null;
}

/** The message shown when the AI was cut off mid-answer (stop reason max_tokens). */
export const TRUNCATED_MESSAGE =
  "The AI ran out of room before it finished the cards, so nothing was saved. Split the source into smaller parts (or paste the most relevant section) and try again.";

/** Map a runStructured failure to what the writer sees, calling out truncation. */
export function describeFailure(reason: string): string {
  return /ran out of room|max_tokens/i.test(reason) ? TRUNCATED_MESSAGE : reason;
}

// ---------------------------------------------------------------------------
// Topic groups
// ---------------------------------------------------------------------------

export type GroupingResult = { groups: { name: string; cards: number[] }[] };

export const GROUPING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["groups"],
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "cards"],
        properties: {
          name: { type: "string" },
          cards: { type: "array", items: { type: "integer" } },
        },
      },
    },
  },
} as const;

export const GROUPING_SYSTEM = `You help a copywriter sort research index cards into piles. Each pile is one theme the writer could turn into a section of a piece.

Make between 2 and 8 piles. Give each a short, concrete name of 2 to 5 words (for example "Who is already using it", not "Miscellaneous"). Put every card in exactly one pile, using the card numbers you are given. A pile can hold a single card if it truly stands alone. Group by what the cards are about, not by card type or by source.`;

export function groupingPrompt(input: { brandContext: string; projectName: string; cards: { topic: string; summary: string; tags: string[] }[] }): string {
  return [
    input.brandContext,
    "",
    `Research project: ${input.projectName}`,
    "",
    "Cards:",
    ...input.cards.map((card, index) => `${index + 1}. ${card.topic}: ${card.summary.slice(0, 300)}${card.tags.length ? ` [${card.tags.join(", ")}]` : ""}`),
    "",
    "Sort these cards into piles.",
  ].join("\n");
}

/**
 * Map the AI's piles (1-based card numbers) back to card ids. Each card lands
 * in at most one pile (first wins); unknown numbers are ignored; cards the AI
 * skipped are left out so they keep whatever group they had.
 */
export function applyGrouping(cardIds: string[], result: unknown): Map<string, string> {
  const groups = Array.isArray((result as GroupingResult | null)?.groups) ? (result as GroupingResult).groups : [];
  const assigned = new Map<string, string>();
  for (const group of groups) {
    const name = str(group?.name, 60);
    if (!name || !Array.isArray(group.cards)) continue;
    for (const number of group.cards) {
      const id = Number.isInteger(number) ? cardIds[number - 1] : undefined;
      if (id && !assigned.has(id)) assigned.set(id, name);
    }
  }
  return assigned;
}

// ---------------------------------------------------------------------------
// Brain note (only when the project owner turns sharing on)
// ---------------------------------------------------------------------------

export function brainNote(input: {
  projectName: string;
  description: string;
  brandName: string;
  sources: { title: string; sourceRef: string | null }[];
  cards: { topic: string; summary: string; groupName: string | null; keyPoints: KeyPoint[]; sourceLabel: string }[];
}): { title: string; body: string } {
  const groups = new Map<string, typeof input.cards>();
  for (const card of input.cards) {
    const name = card.groupName || "Ungrouped";
    groups.set(name, [...(groups.get(name) ?? []), card]);
  }
  const lines = [
    `Research cards from the project "${input.projectName}" for ${input.brandName}. Facts and quotes below are copied from the listed sources; check them there before use.`,
    "",
  ];
  if (input.description) lines.push(input.description, "");
  for (const [name, cards] of groups) {
    lines.push(`## ${name}`, "");
    for (const card of cards) {
      lines.push(`- **${card.topic}**: ${card.summary}${card.sourceLabel ? ` (${card.sourceLabel})` : ""}`);
      for (const point of card.keyPoints.slice(0, 4)) lines.push(`  - ${point.text}${point.location ? ` [${point.location}]` : ""}`);
    }
    lines.push("");
  }
  if (input.sources.length) {
    lines.push("## Sources", "");
    for (const source of input.sources) lines.push(`- ${source.title}${source.sourceRef && /^https?:/.test(source.sourceRef) ? `: ${source.sourceRef}` : ""}`);
  }
  return { title: `Research: ${input.projectName}`, body: lines.join("\n").trim() };
}
