import { Document, ExternalHyperlink, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { exportBlocks, type ExportProject } from "../../../../../modules/research/export";

/** The outline as a Word file. Walks the same blocks as the Markdown export. */
export async function outlineDocx(project: ExportProject): Promise<Buffer> {
  const children: Paragraph[] = [];
  for (const block of exportBlocks(project)) {
    switch (block.type) {
      case "title":
        children.push(new Paragraph({ text: block.text, heading: HeadingLevel.TITLE }));
        break;
      case "subtitle":
        children.push(new Paragraph({ children: [new TextRun({ text: block.text, italics: true, color: "667085" })], spacing: { after: 200 } }));
        break;
      case "paragraph":
        children.push(new Paragraph({ text: block.text, spacing: { after: 200 } }));
        break;
      case "section":
        children.push(new Paragraph({ text: block.text, heading: HeadingLevel.HEADING_2, spacing: { before: 320, after: 120 } }));
        break;
      case "bullet":
        children.push(new Paragraph({ text: block.text, bullet: { level: 0 } }));
        break;
      case "card":
        children.push(new Paragraph({ bullet: { level: 1 }, children: [new TextRun({ text: `${block.topic}: `, bold: true }), new TextRun(block.summary)] }));
        break;
      case "point":
        children.push(
          new Paragraph({
            bullet: { level: 2 },
            children: [new TextRun(block.text), ...(block.location ? [new TextRun({ text: ` (${block.location})`, italics: true, color: "667085" })] : [])],
          }),
        );
        break;
      case "source":
        children.push(
          new Paragraph({
            bullet: { level: 2 },
            children: [
              new TextRun({ text: "Source: ", color: "667085" }),
              block.url && /^https?:\/\//.test(block.url)
                ? new ExternalHyperlink({ link: block.url, children: [new TextRun({ text: block.label, style: "Hyperlink" })] })
                : new TextRun(block.label),
            ],
          }),
        );
        break;
    }
  }
  const doc = new Document({ creator: "PubCommand Research Extractor", title: project.name, sections: [{ children }] });
  return Packer.toBuffer(doc);
}
