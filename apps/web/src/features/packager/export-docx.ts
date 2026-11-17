import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { COMPONENT_STATUS_LABEL, markdownBlocks, type MdBlock, type PackageDirection } from "../../../../../modules/promo-studio/packager";

const HEADINGS = { h1: HeadingLevel.HEADING_2, h2: HeadingLevel.HEADING_2, h3: HeadingLevel.HEADING_3 } as const;

function textRuns(block: MdBlock, extra: { italics?: boolean } = {}): TextRun[] {
  return block.runs.flatMap((run) =>
    run.text.split("\n").map((line, index) => new TextRun({ text: line, bold: run.bold, italics: extra.italics, break: index > 0 ? 1 : undefined })),
  );
}

function blockParagraph(block: MdBlock): Paragraph {
  if (block.type === "h1" || block.type === "h2" || block.type === "h3") {
    return new Paragraph({ children: textRuns(block), heading: HEADINGS[block.type], spacing: { before: 240, after: 120 } });
  }
  if (block.type === "bullet") return new Paragraph({ children: textRuns(block), bullet: { level: 0 } });
  if (block.type === "quote") return new Paragraph({ children: textRuns(block, { italics: true }), spacing: { after: 120 }, indent: { left: 360 } });
  return new Paragraph({ children: textRuns(block), spacing: { after: 120 } });
}

const label = (name: string, value: string) => new Paragraph({ children: [new TextRun({ text: `${name}: `, bold: true }), new TextRun(value)] });

/** The whole package as a Word document: a cover with the direction, then one section per component. */
export async function packageDocx(input: {
  title: string;
  promoTitle: string;
  brandName: string;
  status: string;
  direction: PackageDirection;
  components: { label: string; quantity: number; status: string; content: string }[];
}): Promise<Buffer> {
  const d = input.direction;
  const cover: Paragraph[] = [
    new Paragraph({ text: input.title, heading: HeadingLevel.TITLE }),
    label("Promo", input.promoTitle),
    label("Brand", input.brandName),
    label("Status", input.status === "APPROVED" ? "Approved" : "Draft"),
  ];
  const direction = [
    d.angle ? label("Angle", d.angle) : null,
    d.tone ? label("Tone", d.tone) : null,
    d.length !== "standard" ? label("Length", d.length) : null,
    d.offerDetails ? label("Offer details", d.offerDetails) : null,
    d.notes ? label("Notes", d.notes) : null,
    d.event ? label("Live event", `${d.event.name}${d.event.date ? ` (${d.event.date})` : ""}`) : null,
  ].filter((p): p is Paragraph => p !== null);
  if (direction.length) cover.push(new Paragraph({ text: "Direction", heading: HeadingLevel.HEADING_1, spacing: { before: 240 } }), ...direction);
  cover.push(
    new Paragraph({ text: "Contents", heading: HeadingLevel.HEADING_1, spacing: { before: 240 } }),
    ...input.components.map((c) => new Paragraph({ text: `${c.label} (${c.quantity}) · ${COMPONENT_STATUS_LABEL[c.status] ?? c.status}`, bullet: { level: 0 } })),
  );
  const sections = [
    { children: cover },
    ...input.components.map((c) => ({
      children: [
        new Paragraph({ text: c.label, heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ children: [new TextRun({ text: `${COMPONENT_STATUS_LABEL[c.status] ?? c.status}`, italics: true })], spacing: { after: 200 } }),
        ...(c.content.trim() ? markdownBlocks(c.content).map(blockParagraph) : [new Paragraph({ children: [new TextRun({ text: "Not written yet.", italics: true })] })]),
      ],
    })),
  ];
  return Packer.toBuffer(new Document({ sections }));
}

export function fileSafe(name: string): string {
  return name.replace(/[^\w\- ]+/g, "").trim().slice(0, 120) || "package";
}
