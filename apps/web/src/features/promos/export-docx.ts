import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import type { PromoAnalysisResult } from "../../../../../modules/promo-studio/analysis";

const h = (text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_2) => new Paragraph({ text, heading: level, spacing: { before: 240, after: 120 } });
const p = (text: string) => new Paragraph({ children: [new TextRun(text)], spacing: { after: 120 } });
const bullet = (text: string) => new Paragraph({ text, bullet: { level: 0 } });
const label = (name: string, value: string) => new Paragraph({ children: [new TextRun({ text: `${name}: `, bold: true }), new TextRun(value || "—")] });

/** A Word report of one analysis. */
export async function analysisDocx(input: { title: string; brand: string; score: number | null; result: PromoAnalysisResult }): Promise<Buffer> {
  const r = input.result;
  const children: Paragraph[] = [
    new Paragraph({ text: input.title, heading: HeadingLevel.TITLE }),
    label("Brand", input.brand),
    label("Publisher", r.detected.publisher),
    label("Guru", r.detected.gurus.join(", ")),
    label("Score", input.score != null ? `${input.score.toFixed(1)}/10` : "n/a"),
    h("Summary"),
    p(r.summary),
    label("Big idea", r.sixteenWord.bigIdea),
    h("Scorecard"),
    ...r.scores.map((s) => bullet(`${s.name}: ${s.score}/10 — ${s.note}`)),
    h("What works"),
    ...r.strengths.map(bullet),
    h("Top fixes"),
    ...r.fixes.map(bullet),
    h("Headline"),
    label("Eyebrow", r.headline.eyebrow),
    label("Headline", r.headline.headline),
    label("Subhead", r.headline.subhead),
    bullet(`Urgent ${r.headline.fourUs.urgent.score}/10 — ${r.headline.fourUs.urgent.note}`),
    bullet(`Unique ${r.headline.fourUs.unique.score}/10 — ${r.headline.fourUs.unique.note}`),
    bullet(`Ultra-specific ${r.headline.fourUs.ultraSpecific.score}/10 — ${r.headline.fourUs.ultraSpecific.note}`),
    bullet(`Useful ${r.headline.fourUs.useful.score}/10 — ${r.headline.fourUs.useful.note}`),
    p(r.headline.verdict),
    h("Alternative headlines", HeadingLevel.HEADING_3),
    ...r.headline.alternatives.map(bullet),
    h("Outline"),
    ...r.outline.map((o, i) => p(`${i + 1}. ${o.section} — ${o.summary}`)),
    h("16-Word Sales Letter"),
    ...r.sixteenWord.questions.flatMap((q, i) => [
      new Paragraph({ children: [new TextRun({ text: `${i + 1}. ${q.question} `, bold: true }), new TextRun(`(${q.answered})`)] }),
      p(`Evidence: ${q.evidence}`),
      p(`Improve: ${q.improve}`),
    ]),
    h("The close", HeadingLevel.HEADING_3),
    ...r.sixteenWord.close.map((c) => bullet(`${c.present ? "✓" : "✗"} ${c.step} — ${c.note}`)),
    h("CUB review"),
    ...r.cub.flatMap((c, i) => [
      new Paragraph({ children: [new TextRun({ text: `${i + 1}. ${c.type.toUpperCase()}: `, bold: true }), new TextRun({ text: `“${c.quote}”`, italics: true })] }),
      p(c.why),
      p(`Fix: ${c.fix}`),
    ]),
    h("Offer"),
    label("Product", r.offer.product),
    label("Price", r.offer.price),
    label("Term", r.offer.term),
    label("Guarantee", r.offer.guarantee),
    label("Urgency", r.offer.urgency),
    ...r.offer.bonuses.map(bullet),
    p(r.offer.summary),
    h("Stock tease"),
    p(r.stockTease.teased ? "A stock is teased. Guesses below are from clues, not facts." : "No stock tease detected."),
    ...r.stockTease.guesses.map((g) => bullet(`${g.ticker} (${g.company}) — ${g.confidence}: ${g.why}`)),
    h("Lessons"),
    ...r.lessons.map(bullet),
  ];
  return Packer.toBuffer(new Document({ sections: [{ children }] }));
}
