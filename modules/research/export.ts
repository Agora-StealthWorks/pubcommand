/**
 * Outline export: numbered sections of bullets, with the research cards placed
 * on each bullet indented beneath it (summary, then the exact facts and quotes
 * with their source location). The Word export in apps/web walks the same
 * `exportBlocks` list, so Markdown and DOCX always carry the same content.
 */

import type { KeyPoint } from "./extract";

export type ExportCard = {
  id: string;
  topic: string;
  summary: string;
  keyPoints: KeyPoint[];
  sourceLabel: string;
  sourceUrl: string | null;
};

export type ExportProject = {
  name: string;
  description: string;
  brandName: string;
  sections: { title: string; bullets: { text: string; cardIds: string[] }[] }[];
  cards: ExportCard[];
  /** Append the cards that are not on any bullet. */
  includeUnplaced?: boolean;
};

export type ExportBlock =
  | { type: "title"; text: string }
  | { type: "subtitle"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "section"; text: string }
  | { type: "bullet"; text: string }
  | { type: "card"; topic: string; summary: string }
  | { type: "point"; text: string; location: string }
  | { type: "source"; label: string; url: string | null };

export function exportBlocks(project: ExportProject): ExportBlock[] {
  const byId = new Map(project.cards.map((card) => [card.id, card]));
  const placed = new Set<string>();
  const blocks: ExportBlock[] = [
    { type: "title", text: project.name || "Research outline" },
    { type: "subtitle", text: `${project.brandName} · Research outline` },
  ];
  if (project.description.trim()) blocks.push({ type: "paragraph", text: project.description.trim() });
  const cardBlocks = (card: ExportCard) => {
    blocks.push({ type: "card", topic: card.topic, summary: card.summary });
    for (const point of card.keyPoints) blocks.push({ type: "point", text: point.text, location: point.location });
    if (card.sourceLabel || card.sourceUrl) blocks.push({ type: "source", label: card.sourceLabel || card.sourceUrl || "", url: card.sourceUrl });
  };
  project.sections.forEach((section, index) => {
    blocks.push({ type: "section", text: `${index + 1}. ${section.title.trim() || "Untitled section"}` });
    for (const bullet of section.bullets) {
      blocks.push({ type: "bullet", text: bullet.text.trim() || "(empty bullet)" });
      for (const id of bullet.cardIds) {
        const card = byId.get(id);
        if (!card) continue;
        placed.add(id);
        cardBlocks(card);
      }
    }
  });
  if (project.includeUnplaced) {
    const rest = project.cards.filter((card) => !placed.has(card.id));
    if (rest.length) {
      blocks.push({ type: "section", text: "Research not yet in the outline" });
      for (const card of rest) cardBlocks(card);
    }
  }
  return blocks;
}

/** Escape characters that would turn plain text into Markdown formatting. */
export function mdEscape(text: string): string {
  return text.replace(/([\\`*_[\]<>#|])/g, "\\$1").replace(/\n+/g, " ");
}

export function outlineMarkdown(project: ExportProject): string {
  const lines: string[] = [];
  for (const block of exportBlocks(project)) {
    switch (block.type) {
      case "title":
        lines.push(`# ${mdEscape(block.text)}`, "");
        break;
      case "subtitle":
        lines.push(`_${mdEscape(block.text)}_`, "");
        break;
      case "paragraph":
        lines.push(mdEscape(block.text), "");
        break;
      case "section":
        if (lines[lines.length - 1] !== "") lines.push("");
        lines.push(`## ${mdEscape(block.text)}`, "");
        break;
      case "bullet":
        lines.push(`- ${mdEscape(block.text)}`);
        break;
      case "card":
        lines.push(`  - **${mdEscape(block.topic)}**: ${mdEscape(block.summary)}`);
        break;
      case "point":
        lines.push(`    - ${mdEscape(block.text)}${block.location ? ` _(${mdEscape(block.location)})_` : ""}`);
        break;
      case "source":
        lines.push(block.url && /^https?:\/\//.test(block.url) ? `    - Source: [${mdEscape(block.label)}](${block.url.replace(/[()\s]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`)})` : `    - Source: ${mdEscape(block.label)}`);
        break;
    }
  }
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

/** A safe download file name. */
export function exportFilename(name: string, extension: "md" | "docx"): string {
  const base = name.replace(/[^\w\- ]+/g, "").replace(/\s+/g, " ").trim().slice(0, 80) || "research";
  return `${base} - outline.${extension}`;
}
