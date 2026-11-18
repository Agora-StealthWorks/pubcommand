import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { locateCub, readingEaseLabel, type PromoAnalysisResult } from "../../../../../modules/promo-studio/analysis";
import { parseAnalysis } from "../../../../../modules/promo-studio/parse";
import { cubQuotes, effectiveScorecard, isStoredV2, type StoredAnalysisV2 } from "../../../../../modules/promo-studio/stored";

const h = (text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_2) => new Paragraph({ text, heading: level, spacing: { before: 240, after: 120 } });
const p = (text: string) => new Paragraph({ children: [new TextRun(text)], spacing: { after: 120 } });
const bullet = (text: string) => new Paragraph({ text, bullet: { level: 0 } });
const label = (name: string, value: string) => new Paragraph({ children: [new TextRun({ text: `${name}: `, bold: true }), new TextRun(value || "—")] });

type ExportInput = {
  title: string;
  brand: string;
  score: number | null;
  result: unknown;
  sourceText: string;
  fk: { ease: number; grade: number } | null;
};

/** A Word report of one analysis, in whichever shape it was saved. */
export async function analysisDocx(input: ExportInput): Promise<Buffer> {
  const children = isStoredV2(input.result) ? sectionsDoc(input, input.result) : legacyDoc(input, input.result as PromoAnalysisResult);
  return Packer.toBuffer(new Document({ sections: [{ children }] }));
}

const RATING = { strong: "Strong", weak: "Present but weak", missing: "Missing" } as const;
const HIGHLIGHT = { confusing: "yellow", unbelievable: "red", boring: "lightGray" } as const;

function sectionsDoc(input: ExportInput, stored: StoredAnalysisV2): Paragraph[] {
  const a = parseAnalysis(stored.sections);
  const card = effectiveScorecard(stored);
  const o = a.offer;
  const out: Paragraph[] = [
    new Paragraph({ text: input.title, heading: HeadingLevel.TITLE }),
    label("Brand", input.brand),
    label("Score", card.final != null ? `${card.final.toFixed(1)}/10${card.calibrated ? " (re-evaluated with publisher feedback)" : ""}` : "n/a"),
  ];
  if (input.fk) out.push(label("Reading ease", `${input.fk.ease} (${readingEaseLabel(input.fk.ease)}) · grade ${input.fk.grade}`));
  if (stored.truncated) out.push(p("Note: the AI ran out of room before finishing; some sections are missing."));

  out.push(h("Summary"), label("Big idea", o.bigIdea));
  out.push(
    label("Publisher", `${o.publisher}${o.publisherInferred ? " (inferred, low confidence)" : ""}`),
    label("Product", o.product),
    label("What it is", o.whatItIs),
    label("Prices", o.prices),
    label("Payment options", o.paymentOptions),
    label("Premiums", o.premiums.length ? "" : "—"),
    ...o.premiums.map(bullet),
    label("Guarantee", o.guarantee),
    label("Urgency", o.urgency),
  );
  if (a.tease.present) {
    out.push(h("Tease", HeadingLevel.HEADING_3), p(`Teased: ${a.tease.subject || "something held back"}. Guesses come from the clues, not facts.`));
    out.push(...a.tease.clues.map((c) => bullet(`Clue: ${c}`)), ...a.tease.guesses.map((g) => bullet(`Guess: ${g}`)));
    if (a.tease.confidence) out.push(label("Confidence", a.tease.confidence));
  }
  out.push(h("Score", HeadingLevel.HEADING_3), ...card.dimensions.map((d) => bullet(`${d.name}: ${d.score}/10 — ${d.rationale}`)));
  if (card.adjustment) out.push(bullet(`Adjustment: ${card.adjustment.value > 0 ? "+" : ""}${card.adjustment.value} — ${card.adjustment.reason}`));
  if (card.rationale) out.push(p(card.rationale));

  out.push(h("Headline"), label("Eyebrow", a.headline.eyebrow), label("Headline", a.headline.headline), label("Subhead", a.headline.subhead));
  out.push(...a.headline.fourUs.map((u) => bullet(`${u.label}: ${u.rating ?? "?"} — ${u.note}`)));
  if (a.headline.verdict) out.push(p(a.headline.verdict));

  out.push(h("Outline"), ...a.outline.map((item, i) => p(`${i + 1}. ${item.title}${item.purpose ? ` — ${item.purpose}` : ""}`)));

  out.push(h("16-Word Sales Letter"));
  for (const item of a.sixteenWord.items) {
    out.push(new Paragraph({ children: [new TextRun({ text: `${item.kind === "question" ? `Q${item.number}` : `C${item.number}`}. ${item.label} `, bold: true }), new TextRun(`(${item.rating ? RATING[item.rating] : "?"})`)] }));
    if (item.note) out.push(p(item.note));
  }
  if (a.sixteenWord.verdict) out.push(p(a.sixteenWord.verdict));

  out.push(h("CUB review"));
  const flags = a.cub ?? [];
  if (a.cub === null) out.push(p("The CUB review could not be read."));
  else if (!flags.length) out.push(p("No lines flagged."));
  for (const [i, c] of flags.entries()) {
    out.push(new Paragraph({ children: [new TextRun({ text: `${i + 1}. ${c.type.toUpperCase()}: `, bold: true }), new TextRun({ text: `“${c.text}”`, italics: true })] }), p(c.reason));
  }
  if (input.sourceText && flags.length) {
    out.push(h("Annotated copy", HeadingLevel.HEADING_3), p("Yellow = confusing, red = unbelievable, grey = boring."));
    const spans = locateCub(input.sourceText, cubQuotes(flags));
    let runs: TextRun[] = [];
    let cursor = 0;
    const flush = (text: string, flag?: (typeof flags)[number]) => {
      const parts = text.split("\n");
      parts.forEach((part, index) => {
        if (index > 0) {
          out.push(new Paragraph({ children: runs }));
          runs = [];
        }
        if (part) runs.push(new TextRun(flag ? { text: part, highlight: HIGHLIGHT[flag.type] } : { text: part }));
      });
    };
    for (const span of spans) {
      flush(input.sourceText.slice(cursor, span.start));
      flush(input.sourceText.slice(span.start, span.end), flags[span.index]);
      cursor = span.end;
    }
    flush(input.sourceText.slice(cursor));
    if (runs.length) out.push(new Paragraph({ children: runs }));
  }
  return out;
}

function legacyDoc(input: ExportInput, r: PromoAnalysisResult): Paragraph[] {
  return [
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
    ...(["urgent", "unique", "ultraSpecific", "useful"] as const).map((k) => bullet(`${k} ${r.headline.fourUs[k]?.score ?? "?"}/10 — ${r.headline.fourUs[k]?.note ?? ""}`)),
    p(r.headline.verdict),
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
    h("Tease"),
    p(r.tease.teased ? `The promo teases a ${r.tease.subject || "secret"}. Guesses below come from clues, not facts.` : "No tease detected."),
    ...r.tease.guesses.map((g) => bullet(`${g.name}${g.detail ? ` (${g.detail})` : ""} — ${g.confidence}: ${g.why}`)),
    h("Compliance"),
    ...(r.compliance.length
      ? r.compliance.flatMap((c, i) => [
          new Paragraph({ children: [new TextRun({ text: `${i + 1}. ${c.risk.toUpperCase()} — ${c.rule}: `, bold: true }), new TextRun({ text: `“${c.quote}”`, italics: true })] }),
          p(`Rewrite: ${c.fix}`),
        ])
      : [p("No compliance problems found.")]),
    h("Lessons"),
    ...r.lessons.map(bullet),
  ];
}
