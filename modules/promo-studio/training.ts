/**
 * The Packager's training library: approved components and best performers
 * kept as reusable examples, and the retrieval that picks which ones a
 * generation sees. Pure functions only.
 */

import { componentSpec } from "./packager";

export type TrainingExample = {
  id: string;
  kind: string;
  publication: string | null;
  niche: string;
  title: string;
  content: string;
  source: string;
  sourceRef: string | null;
  enabled: boolean;
  tags: readonly string[];
  updatedAt: Date;
};

export const EXAMPLE_SOURCES = ["component", "best-performer", "manual"] as const;
export const EXAMPLE_SOURCE_LABEL: Record<string, string> = { component: "Approved component", "best-performer": "Best performer", manual: "Added by hand" };

/** Examples a generation sees per component, and how much of each. */
export const EXAMPLES_PER_COMPONENT = 3;
export const EXAMPLE_CHARS = 6000;

const norm = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();

/**
 * Pick examples for one component: same component type and turned on, never
 * one from the package being written, and never another niche's copy (a health
 * brand should not learn from finance copy). Same publication ranks first,
 * then best performers, then the newest.
 */
export function rankExamples<T extends TrainingExample>(
  examples: readonly T[],
  want: { kind: string; publication: string | null; niche: string; excludeRefs?: readonly string[] },
  limit = EXAMPLES_PER_COMPONENT,
): T[] {
  const exclude = new Set(want.excludeRefs ?? []);
  const publication = norm(want.publication);
  return examples
    .filter((example) => example.enabled && example.kind === want.kind && example.content.trim())
    .filter((example) => !example.sourceRef || !exclude.has(example.sourceRef))
    .filter((example) => norm(example.niche) === norm(want.niche) || norm(example.niche) === "general")
    .map((example) => {
      let score = 0;
      if (publication && norm(example.publication) === publication) score += 4;
      if (example.source === "best-performer") score += 2;
      if (example.source === "manual") score += 1;
      if (norm(example.niche) === norm(want.niche)) score += 1;
      return { example, score };
    })
    .sort((a, b) => b.score - a.score || b.example.updatedAt.getTime() - a.example.updatedAt.getTime())
    .slice(0, limit)
    .map((row) => row.example);
}

/** The prompt block: examples to learn voice and format from, never claims or numbers. */
export function examplesBlock(examples: readonly Pick<TrainingExample, "title" | "content" | "source" | "publication">[]): string {
  if (!examples.length) return "";
  const body = examples
    .map((example, index) => {
      const text = example.content.length > EXAMPLE_CHARS ? `${example.content.slice(0, EXAMPLE_CHARS)}\n[…cut for length]` : example.content;
      const label = [EXAMPLE_SOURCE_LABEL[example.source] ?? example.source, example.publication].filter(Boolean).join(", ");
      return `## Example ${index + 1}: ${example.title} (${label})\n${text}`;
    })
    .join("\n\n");
  return `<examples>\nThis brand's approved copy for this component type. Mirror the format, rhythm and voice; vary which example you follow across the set. Never reuse their claims, numbers, names or offers: those belong to other promos.\n${body}\n</examples>`;
}

/** Refs that point at the package being written, so it never learns from itself. */
export function excludeRefsFor(componentIds: readonly string[], promoId: string): string[] {
  return [...componentIds.map((id) => `component:${id}`), `best-performer:${promoId}`];
}

/** An approved component as a library example. */
export function exampleFromComponent(input: { componentId: string; kind: string; content: string; promoTitle: string; promoId: string; publication: string | null; niche: string }) {
  const spec = componentSpec(input.kind);
  return {
    kind: input.kind,
    publication: input.publication,
    niche: input.niche,
    title: `${spec?.label ?? input.kind}: ${input.promoTitle}`.slice(0, 200),
    content: input.content.slice(0, 60000),
    source: "component" as const,
    sourceRef: `component:${input.componentId}`,
    promoId: input.promoId,
  };
}

/** A best-performing promo's opening (eyebrow, headline, subhead) as a headline example. */
export function exampleFromBestPerformer(input: {
  promoId: string;
  title: string;
  publication: string | null;
  niche: string;
  headline: { eyebrow?: string; headline: string; subhead?: string } | null;
  performance: string | null;
}) {
  if (!input.headline?.headline.trim()) return null;
  const lines = [
    "### Headline",
    input.headline.eyebrow?.trim() ? `**Eyebrow:** ${input.headline.eyebrow.trim()}` : "**Eyebrow:** none",
    `**Headline:** ${input.headline.headline.trim()}`,
    input.headline.subhead?.trim() ? `**Subhead:** ${input.headline.subhead.trim()}` : "**Subhead:** none",
  ];
  return {
    kind: "alternative-headlines",
    publication: input.publication,
    niche: input.niche,
    title: `Best performer: ${input.title}`.slice(0, 200),
    content: lines.join("\n\n"),
    source: "best-performer" as const,
    sourceRef: `best-performer:${input.promoId}`,
    promoId: input.promoId,
    note: input.performance,
  };
}

/** How many usable examples each component type has (for the coverage strip). */
export function coverage(examples: readonly Pick<TrainingExample, "kind" | "enabled">[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const example of examples) if (example.enabled) out.set(example.kind, (out.get(example.kind) ?? 0) + 1);
  return out;
}

export function parseTags(raw: string): string[] {
  return [...new Set(raw.split(",").map((tag) => tag.trim().toLowerCase().slice(0, 40)).filter(Boolean))].slice(0, 10);
}
