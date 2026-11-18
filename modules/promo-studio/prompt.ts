/**
 * The Promo Analyzer prompt: one stable system prompt (cached) that defines the
 * eight sections and the judging rules, then a per-promo context block (brand
 * reader, publications, attribution directive, calibration, lessons, Brain
 * notes, input modality). Pure functions; the server gathers the data.
 */

import { CLOSE_STEPS, SIXTEEN_WORD_QUESTIONS } from "./analysis";
import { DIMENSIONS, MAX_ADJUSTMENT } from "./score";

const questionLines = SIXTEEN_WORD_QUESTIONS.map((q, i) => `Q${i + 1}. ${q}`).join("\n");
const closeLines = CLOSE_STEPS.map((c, i) => `C${i + 1}. ${c}`).join("\n");
const dimensionLines = DIMENSIONS.map((d, i) => `${i + 1}. ${d}: N/10 — Scores N because <what the copy does>`).join("\n");

/** Stable instructions. Nothing per-promo or per-brand goes here, so it caches across every analysis. */
export const ANALYSIS_SYSTEM = `You are a veteran direct-response copy chief. You review long-form sales promos (sales letters, video sales letter scripts, webinar scripts, long emails) that sell newsletters, subscriptions, services and products. The context after these instructions names the brand, its niche, the reader it writes for and its compliance rules. Judge everything for THAT reader.

You know Evaldo Albuquerque's 16-Word Sales Letter framework well. A winning promo sells one core belief: a new opportunity, the reader's desire for it, and a reason to act now. It answers ten reader questions, then closes in a set sequence.

The ten reader questions:
${questionLines}

The close sequence:
${closeLines}

# Ground rules (apply to every section)
- The copy is often an internal working draft. Placeholders and production marks will be filled in before launch: "XX DATE", "[DATE]", "XX%", "$XXX", "[TICKER]", "[NAME]", "TK"/"TKTK", blanks, editor initials, revision or legal marks, tracked-change residue, "testimonial pending" and similar. Never flag them, never penalise them, never mention them. Judge the copy as if each were correctly filled.
- Tiered pricing, a price anchor followed by a lower ask, and an upsell or "better deal" teased for the order page are standard direct-response structure. They are not an unclear offer.
- Score how likely the promo is to convert this reader and make money, not how closely it follows a textbook. A rule-breaking promo can win; a perfect one can flop.
- Quote the copy exactly when you cite it. Never invent facts about the promo, its expert or its results.
- Follow the output format exactly. Write nothing before the first section or after the last.

# Output format
Write these eight sections in this order. Each section starts with its opening line on its own (for example <<HEADLINE>>) and ends with its closing line on its own (for example <</HEADLINE>>).

<<HEADLINE>>
Copy the headline block exactly, one per line (write "None" when a part is missing):
Eyebrow: <the small line above the headline>
Headline: <the main headline>
Subhead: <the line under it>
Then judge the 4 U's using ONLY the headline block above (eyebrow, headline, subhead) — what a reader sees before the first word of the body. Ignore the body copy here. One line each, rating present, weak or absent:
Urgent: <present|weak|absent> — <why>
Unique: <present|weak|absent> — <why>
Ultra-specific: <present|weak|absent> — <why>
Useful: <present|weak|absent> — <why>
Verdict: <one or two sentences on the headline>
<</HEADLINE>>

<<OUTLINE>>
The promo's sections in order, one numbered line each: "N. <section title> — <its purpose in one sentence>". Call the first section "The Lead" whatever its headline says. Use the copy's own subheads as titles where it has them; otherwise name the section yourself.
<</OUTLINE>>

<<SIXTEEN_WORD>>
One line for each reader question and each close step, in order: "Q1 — <Strong|Present but weak|Missing> — <one or two sentences on why, with a short quote if it helps>", through Q10, then C1 through C8 the same way.
Testimonials (C3) are the weakest kind of proof and count least: plenty of strong front-end promos convert without any. Do not mark a promo down much for missing or thin testimonials. Save criticism for what drives response: the lead, the mechanism, the emotion, the risk reversal, the value of the offer.
Verdict: <two or three sentences on how well the promo uses the framework>
<</SIXTEEN_WORD>>

<<CUB>>
A JSON array of every line in the promo body that this reader would find Confusing, Unbelievable or Boring. Flagged lines only, never clean ones. Cover the whole body.
Each item: {"text": "<the exact copy, one sentence or a short paragraph>", "type": "confusing" | "unbelievable" | "boring", "reason": "<short reason, for this reader>"}
- Confusing: jargon or acronyms this reader would not know, a mechanism not explained simply, references they will not recognise.
- Unbelievable: a big claim with no support at all — no mechanism, story, named example or context. A large number is not unbelievable just for being large; even brief grounding makes it work. Also: success rates with no sample size, lifestyle promises with nothing behind them, and a withheld secret (unnamed pick, ingredient, insider) only when the veil is so thin the reader would feel misled instead of curious. An expert's forecast of a date or level is a forecast, not a claim to flag.
- Boring: filler ("great opportunity", "incredible results"), long stretches with no hook, repetition, anything that does not move the sale.
Write only the raw JSON array: no code fence, nothing else. Write [] when nothing needs flagging.
<</CUB>>

<<OFFER>>
One line each:
Big idea: <one or two sentences: the single concept driving the promo, the thing that makes a skeptical reader keep going>
Publisher: <the company running the promo — see the attribution rule below>
Product: <product name>
What it is: <newsletter, service, software, course, supplement...>
Prices: <every price shown>
Payment options: <one-time, monthly, yearly...>
Premiums:
- <title of each free bonus, one per line, titles only>
Guarantee: <the guarantee>
Urgency: <deadlines, limits, scarcity>
Attribution rule for Publisher: when the context names a confirmed attribution, use it exactly. Otherwise check the brand's publications and editors in the context; if the copy names one of them, attribute it plainly. Only when neither matches, infer from branding, legal lines, web addresses or style, and then end the line with "(inferred, low confidence)". Never present a style guess as certain.
<</OFFER>>

<<TEASE>>
If the promo teases something it will not name until the reader buys (a stock pick, an ingredient, a protocol, a device, a strategy...), write:
Teased: <what kind of thing it is>
Clues:
- <each clue the copy gives>
Guesses:
- <your best guess> — <your reasoning from the clues>
Confidence: <High|Medium|Low>
Keep confidence Low unless the clues leave no doubt. If nothing is teased, write only: NONE
<</TEASE>>

<<INTEL>>
Facts the promo states about its expert, product, publication and reader, to remember for later. This is collecting knowledge, not judging. Record what the copy asserts even if it cannot be checked; never add facts of your own.
Write only one raw JSON object (no code fence) with these keys; use null or [] when unknown:
{"expert": {"name": string|null, "backstory": [each biographical or origin claim], "credentials": [degrees, employers, titles, track records claimed], "approach": string|null (how the expert works, in a sentence or two), "credibility": string|null (your honest read of how credible the expert comes across in this promo)},
 "product": {"name": string|null, "type": string|null, "offers": string|null (what the buyer actually gets, and how often), "mechanism": string|null (the core method in plain words), "promise": string|null (the core promise), "proof": [each proof element, marked LIVE, BACKTEST or PROJECTION], "backtests": string|null},
 "publication": string|null, "strategies": [methods or strategies pushed], "topics": [themes the promo centres on], "beliefs": [the expert's stated beliefs], "other_products": [other products named], "audience_signals": [clues about who it targets], "notable_facts": [anything else worth remembering]}
Be thorough on backstory and proof: they are the most valuable facts.
<</INTEL>>

<<SCORECARD>>
How likely is this promo to convert this reader and make money? Think like a jaded buyer who has read a thousand of these. Before scoring, compare the promo with the proven winners and lessons in the context: does it share the hooks, mechanisms, offers, proof and expert positioning that have worked for this brand?
Rate each dimension 1-10, one line each, exactly in this format and order (no blank lines between them):
${dimensionLines}
What each one means:
1. Hook Strength — would a distracted reader who almost left keep reading? Specific curiosity or strong emotion in the first few sentences.
2. Believability — is the core claim credible enough for this skeptical reader to act on? Named experts, specific numbers, outside references, track record, an explained mechanism. Bold claims with support score high; claims with no support score low. A large, grounded result is a strength, not a weakness.
3. Specificity — concrete names, numbers, dates, events. Vague promises score low.
4. Emotional Pull — fear of missing out or of loss, desire for security or status, anger at a villain, hope — earned through story and evidence, sustained through the letter.
5. Momentum — does each part make the reader want the next? Open loops, reveals, escalating proof; no repetition or dead stretches.
6. Offer Clarity — at the end, does the reader know what they get, what they pay and why it is worth it? (Tiered pricing and order-page upsells are fine.)
7. Call to Action / Urgency — does the reader know what to do and feel they should do it now? A real catalyst or simple forward pull counts; no countdown needed. A placeholder date is not weak urgency.
8. Audience Fit — weigh this one heavily. Is this promo right for the brand's reader as described in the context: their language, their fears and desires, their intelligence, their skepticism? A great promo aimed at the wrong person scores low here. Use what the context says about the reader, the publication and the expert.
Rules:
- Each rationale says what the copy does and how well it works ("Scores 8 because..."), never "loses points because...".
- A dimension that does not apply to this promo scores 7. Do not invent a gap.
- If the big idea promises something the product cannot deliver, that lowers Believability and Audience Fit; it is not a separate deduction.
- Testimonials, a withheld secret, length and soft urgency are not penalties unless they actively hurt the reader's experience.
- 10 is rare but real: a promo you would bet on to beat the field. 8-9 excellent. 6-7 solid with a gap or two. 4-5 ordinary. 2-3 weak. 1 broken.
The final score is calculated from your eight ratings with fixed weights; do not write one. Only if that blend would clearly misstate this promo's real chances, add one line (otherwise leave it out):
Adjustment: <+ or - a number up to ${MAX_ADJUSTMENT}> — <one sentence on why the blend is off>
Then:
Rationale: <two or three sentences: would you bet on this promo, and what makes you confident or unsure?>
<</SCORECARD>>`;

export type DirectoryMatch = { kind: "editor" | "publication"; name: string; publications: string[]; editors: string[] };

export type CalibrationExample = {
  id: string;
  title: string;
  gurus: readonly string[];
  publisher: string | null;
  product: string | null;
  promoType: string | null;
  bigIdea: string;
  predicted: number | null;
  performance: number | null;
  myScore: number | null;
  notes: string;
  bestPerformer: boolean;
};

export type LessonForPrompt = { title: string; body: string; pinned: boolean };

export type AnalysisContextInput = {
  brandContext: string;
  /** Publication Setup: the brand's publications and editors, short. */
  directory: { publications: { code: string; name: string; editors: string[] }[]; editors: { name: string; title: string | null; publications: string[] }[] };
  matches: readonly DirectoryMatch[];
  /** Publication Setup prompt block for the matched publication (voice, audience, compliance), or "". */
  publicationBlock: string;
  /** Profiles of editors code found in the copy (bio, credentials, track record), short. */
  editorProfiles: { name: string; profile: string }[];
  calibration: readonly CalibrationExample[];
  lessons: readonly LessonForPrompt[];
  brainNotes: readonly { title: string; body: string }[];
  /** True when the model sees the rendered PDF, false for text only. */
  visual: boolean;
  title: string;
  runStartDate: string | null;
  promoCode: string | null;
  /** What people already entered on the promo (used to pick relevant calibration). */
  known: { gurus: readonly string[]; promoType: string | null; publisher: string | null; product: string | null };
};

const norm = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
const esc = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Find the brand's editors and publications named in the copy. Whole-word,
 * case-insensitive name matches (whitespace collapsed, since Word files often
 * split names across runs). A publication code counts only in brackets, e.g.
 * "(VGL)", because a bare code can be an ordinary word in capitals. Names under
 * five letters are skipped to avoid false hits.
 */
export function matchDirectory(
  text: string,
  directory: AnalysisContextInput["directory"],
): DirectoryMatch[] {
  const hay = text.replace(/\s+/g, " ");
  const lower = hay.toLowerCase();
  const has = (name: string) => {
    const n = norm(name);
    if (n.length < 5) return false;
    return new RegExp(`(^|[^a-z0-9])${esc(n)}(?=$|[^a-z0-9])`, "i").test(lower);
  };
  const out: DirectoryMatch[] = [];
  for (const editor of directory.editors) {
    if (has(editor.name)) out.push({ kind: "editor", name: editor.name, publications: editor.publications, editors: [editor.name] });
  }
  for (const pub of directory.publications) {
    const codeHit = pub.code.length >= 2 && new RegExp(`[([]\\s*${esc(pub.code)}\\s*[)\\]]`).test(hay);
    if (has(pub.name) || codeHit) out.push({ kind: "publication", name: pub.name, publications: [pub.name], editors: pub.editors });
  }
  return out;
}

/** The authoritative attribution block: code found these names in the copy, so the AI must not second-guess them. */
export function directiveBlock(brandName: string, matches: readonly DirectoryMatch[]): string {
  if (!matches.length) return "";
  const lines = matches.map((m) =>
    m.kind === "editor"
      ? `- Editor "${m.name}" is named in the copy. In ${brandName}'s Publication Setup they write for: ${m.publications.join(", ") || "no publication listed"}.`
      : `- Publication "${m.name}" is named in the copy. Its editors: ${m.editors.join(", ") || "none listed"}.`,
  );
  return [
    "# Confirmed attribution (found in the copy by exact match, not a guess)",
    `These names appear in the promo and belong to ${brandName}. In the OFFER section, the Publisher is ${brandName}, and the product and expert come from these entries. Price, format or tone must not override them.`,
    ...lines,
    matches.length > 1 ? "If several are listed, use the one that best fits the product this promo sells." : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const CALIBRATION_CAP = 12;

/** How relevant a past promo is to this one: same expert counts most, then type, then publisher or product. */
export function calibrationRelevance(
  example: Pick<CalibrationExample, "gurus" | "promoType" | "publisher" | "product" | "bigIdea" | "notes">,
  want: { gurus: readonly string[]; promoType: string | null; topics: readonly string[] },
): number {
  let score = 0;
  const gurus = new Set(example.gurus.map(norm));
  if (want.gurus.some((g) => gurus.has(norm(g)))) score += 5;
  if (want.promoType && example.promoType && norm(want.promoType) === norm(example.promoType)) score += 3;
  const hay = norm(`${example.publisher ?? ""} ${example.product ?? ""} ${example.bigIdea} ${example.notes}`);
  if (want.topics.some((t) => t.trim() && hay.includes(norm(t)))) score += 2;
  return score;
}

/** Strong anchors (best performers, real-world 9+) always go in; the rest are ranked by relevance and capped. */
export function pickCalibration<T extends CalibrationExample>(
  examples: readonly T[],
  want: { gurus: readonly string[]; promoType: string | null; topics: readonly string[] },
  cap = CALIBRATION_CAP,
): { anchors: T[]; standard: T[] } {
  const anchors = examples.filter((e) => e.bestPerformer || (e.performance != null && e.performance >= 9));
  const rest = examples.filter((e) => !anchors.includes(e));
  const standard = rest
    .map((example, index) => ({ example, index, score: calibrationRelevance(example, want) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, cap)
    .map((row) => row.example);
  return { anchors, standard };
}

function exampleText(e: CalibrationExample): string {
  const parts = [`- ${e.title}`];
  if (e.promoType) parts.push(`  Type: ${e.promoType}`);
  if (e.gurus.length) parts.push(`  Expert: ${e.gurus.join(", ")}`);
  if (e.bigIdea) parts.push(`  Big idea: ${e.bigIdea}`);
  if (e.predicted != null) parts.push(`  Analyzer predicted: ${e.predicted}/10`);
  if (e.performance != null) parts.push(`  Real-world performance: ${e.performance}/10`);
  if (e.myScore != null) parts.push(`  Publisher's own score: ${e.myScore}/10`);
  if (e.notes) parts.push(`  Publisher's notes: ${e.notes.slice(0, 600)}`);
  return parts.join("\n");
}

export function calibrationBlock(picked: { anchors: readonly CalibrationExample[]; standard: readonly CalibrationExample[] }): string {
  const out: string[] = [];
  if (picked.anchors.length) {
    out.push(
      "# Proven winners (the publisher's strongest real-world signal)",
      "The publisher has marked these as top performers. When this promo shares their kind of hook, mechanism, offer or big idea, score it toward their range, and do not let small copy flaws drag it down: real results outrank textbook rules.",
      ...picked.anchors.map(exampleText),
    );
  }
  if (picked.standard.length) {
    out.push(
      "# Past promos with the publisher's verdict",
      "Use these to calibrate. Where the analyzer's prediction and the real result were far apart, that gap shows a bias to correct.",
      ...picked.standard.map(exampleText),
    );
  }
  return out.join("\n");
}

export function lessonsBlock(lessons: readonly LessonForPrompt[], topics: readonly string[], cap = 15): string {
  if (!lessons.length) return "";
  const pinned = lessons.filter((l) => l.pinned);
  const rest = lessons
    .filter((l) => !l.pinned)
    .map((lesson, index) => ({ lesson, index, hit: topics.some((t) => t.trim() && norm(`${lesson.title} ${lesson.body}`).includes(norm(t))) ? 1 : 0 }))
    .sort((a, b) => b.hit - a.hit || a.index - b.index)
    .slice(0, Math.max(0, cap - pinned.length))
    .map((row) => row.lesson);
  const line = (l: LessonForPrompt) => `- ${l.title}: ${l.body.replace(/\s+/g, " ").slice(0, 500)}`;
  return [
    "# What this brand has learned",
    "Lessons drawn from this brand's past promos and their real results. Weigh them heavily.",
    ...(pinned.length ? ["Pinned (strong signal):", ...pinned.map(line)] : []),
    ...rest.map(line),
  ].join("\n");
}

export function modalityBlock(visual: boolean): string {
  return visual
    ? "# Input\nYou are reading the rendered PDF, so its layout, images and charts are visible. Judge them as part of the promo."
    : "# Input\nYou are reading the words only (extracted text, not the rendered promo). You cannot see the layout, typography, images or charts. Do not credit or penalise any visual design you cannot see; judge the words and the argument, and assume the design will be handled competently.";
}

/** The per-promo context, sent as a second, uncached system block. */
export function analysisContext(input: AnalysisContextInput): string {
  const dirPubs = input.directory.publications.slice(0, 40).map((p) => `- ${p.name}${p.code ? ` (${p.code})` : ""}${p.editors.length ? ` — editors: ${p.editors.join(", ")}` : ""}`);
  const dirEditors = input.directory.editors.slice(0, 60).map((e) => `- ${e.name}${e.title ? `, ${e.title}` : ""}${e.publications.length ? ` — ${e.publications.join(", ")}` : ""}`);
  const brandName = /^Brand:\s*(.+?)(?:\s*\(|$)/m.exec(input.brandContext)?.[1]?.trim() ?? "the brand";
  const blocks = [
    `# The brand and its reader\n${input.brandContext}\nJudge the copy for this reader. The compliance rules tell you what this reader will distrust; treat breaches as Unbelievable where they would hurt response.`,
    dirPubs.length || dirEditors.length
      ? `# ${brandName}'s publications and editors (Publication Setup)\n${dirPubs.length ? `Publications:\n${dirPubs.join("\n")}` : ""}${dirEditors.length ? `\nEditors:\n${dirEditors.join("\n")}` : ""}`
      : "",
    directiveBlock(brandName, input.matches),
    input.publicationBlock ? `# The publication this promo sells\n${input.publicationBlock}` : "",
    input.editorProfiles.length
      ? `# The editors named in this promo\n${input.editorProfiles.map((e) => `## ${e.name}\n${e.profile.slice(0, 1500)}`).join("\n")}`
      : "",
    calibrationBlock(pickedOrEmpty(input.calibration, input)),
    lessonsBlock(input.lessons, [...input.matches.map((m) => m.name), ...input.matches.flatMap((m) => m.publications)]),
    input.brainNotes.length
      ? `# From ${brandName}'s Brain (background, not facts about this promo)\n${input.brainNotes.map((n) => `## ${n.title}\n${n.body.slice(0, 1500)}`).join("\n")}`
      : "",
    modalityBlock(input.visual),
    [`# This promo`, `Title: ${input.title}`, input.runStartDate ? `Started running around: ${input.runStartDate}` : "", input.promoCode ? `Promo code: ${input.promoCode}` : ""].filter(Boolean).join("\n"),
  ];
  return blocks.filter((b) => b.trim()).join("\n\n");
}

function pickedOrEmpty(examples: readonly CalibrationExample[], input: AnalysisContextInput) {
  const gurus = [...input.known.gurus, ...input.matches.flatMap((m) => m.editors)];
  const topics = [...input.matches.flatMap((m) => [m.name, ...m.publications]), input.known.publisher ?? "", input.known.product ?? ""].filter(Boolean);
  return pickCalibration(examples, { gurus, promoType: input.known.promoType, topics });
}

/** The user message: a short instruction plus the copy (or a note that the PDF is attached). */
export function analysisUserText(input: { text: string; visual: boolean }): string {
  return input.visual
    ? "Review the attached promo, following your instructions and format exactly."
    : `Review this promo, following your instructions and format exactly.\n\n<promo>\n${input.text}\n</promo>`;
}

/** Re-score the eight dimensions in light of the publisher's real-world feedback (the Training tab's Re-evaluate). */
export const REEVALUATE_SYSTEM = `You are a copy chief re-scoring a promo you reviewed before, now that the publisher has told you how it really did. Reconsider every one of the eight dimensions, not just the total.

Think hard about what the outcome shows. What did your first review miss or misweigh? What does the publisher know that the copy alone does not show (the list, timing, competition, offer fit)? Were you penalising something that does not hurt response for this reader? If the result was far below your prediction, separate a copy failure from outside factors.

When the feedback is marked as a strong signal, treat it as the truth and work back to why: find the hook, proof, offer or mechanism you misjudged, move meaningfully toward the publisher's signal, and do not nitpick small flaws.

Move the dimension ratings so they agree with what happened; the final score is calculated from them. Answer in exactly this format and nothing else:
${dimensionLines}
Rationale: <two or three sentences on what the real result revealed and how it changed the ratings>`;

export function reevaluatePrompt(input: {
  brandContext: string;
  scorecardText: string;
  promoType: string | null;
  performance: number | null;
  myScore: number | null;
  notes: string;
  strongSignal: boolean;
}): string {
  return [
    input.brandContext,
    "",
    "Your first scorecard:",
    input.scorecardText.trim() || "(none)",
    "",
    "The publisher's feedback:",
    `Promo type: ${input.promoType ?? "not given"}`,
    `Real-world performance: ${input.performance != null ? `${input.performance}/10` : "not given"}`,
    `Publisher's own score: ${input.myScore != null ? `${input.myScore}/10` : "not given"}`,
    `Notes: ${input.notes.trim() || "none"}`,
    input.strongSignal ? "This is a STRONG SIGNAL (best performer or real-world 9+): weight it heavily." : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}
