/**
 * The AI summary of a form's results and the Brain note.
 *
 * PRIVACY: both are built ONLY from FormStats (counts, percentages, means).
 * No names, emails, free-text answers, uploads or signatures ever reach the
 * model or the Brain. Free-value buckets (hidden fields, UTM sources) are only
 * included when at least MIN_BUCKET people share the value, so a one-off value
 * typed into a link cannot identify anyone.
 */
import type { FieldStats, FormStats } from "./analytics";

export const MIN_BUCKET = 3;
/** Below this many complete responses a summary says little and percentages can identify people. */
export const MIN_RESPONSES_FOR_SUMMARY = 3;

export type FormSummaryResult = {
  headline: string;
  keyFindings: string[];
  questionNotes: { question: string; note: string }[];
  dataQuality: string[];
  suggestedActions: string[];
};

export const SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "keyFindings", "questionNotes", "dataQuality", "suggestedActions"],
  properties: {
    headline: { type: "string", description: "One sentence: the single most useful takeaway." },
    keyFindings: { type: "array", items: { type: "string" }, description: "3 to 6 findings, each citing the figure it rests on." },
    questionNotes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "note"],
        properties: { question: { type: "string" }, note: { type: "string" } },
      },
    },
    dataQuality: { type: "array", items: { type: "string" }, description: "Caveats: small samples, drop-off, spam held out." },
    suggestedActions: { type: "array", items: { type: "string" }, description: "2 to 4 concrete next steps for the team." },
  },
} as const;

export const SUMMARY_SYSTEM = `You read the aggregated results of one form or survey run by a publisher and write a short briefing for the team that built it.

Rules:
- Use only the figures you are given. Never invent a number, a percentage or a trend. When you cite a figure, it must appear in the input.
- You only ever see aggregates. Do not speculate about individual respondents.
- Small samples are weak evidence: say so when a question has few answers.
- Point out what is surprising or actionable, not what is obvious.
- Write plainly for the brand's team. Match the brand and reader described; do not assume any particular industry.
- Free-text answers are counted but not shown to you. Do not guess what they say.`;

function fieldLine(stats: FieldStats): string {
  const head = `Q "${stats.label}" (${stats.type}), answered by ${stats.answered} of ${stats.base}`;
  switch (stats.kind) {
    case "choice":
    case "multi": {
      const buckets = stats.free ? stats.buckets.filter((bucket) => bucket.count >= MIN_BUCKET) : stats.buckets;
      const shown = buckets.map((bucket) => `${bucket.label}: ${bucket.count} (${bucket.pct}%)`).join("; ");
      const note = stats.kind === "multi" ? " [multiple answers allowed; % of people answering]" : "";
      return `${head}${note}. ${shown || "No value shared by enough people to report."}`;
    }
    case "numeric": {
      const parts = [`mean ${stats.mean ?? "n/a"}`, `median ${stats.median ?? "n/a"}`, `range ${stats.min ?? "n/a"} to ${stats.max ?? "n/a"}`];
      if (stats.buckets.length) parts.push(`distribution ${stats.buckets.map((bucket) => `${bucket.label}=${bucket.count}`).join(", ")}`);
      if (stats.nps) parts.push(`NPS ${stats.nps.score} (promoters ${stats.nps.promoters}, passives ${stats.nps.passives}, detractors ${stats.nps.detractors})`);
      return `${head}. ${parts.join("; ")}`;
    }
    case "bool":
      return `${head}. ${stats.buckets.map((bucket) => `${bucket.label}: ${bucket.count} (${bucket.pct}%)`).join("; ")}`;
    case "date":
      return `${head}. Earliest ${stats.earliest ?? "n/a"}, latest ${stats.latest ?? "n/a"}`;
    case "text":
      return `${head}. Free text, not shown.`;
    case "file":
      return `${head}. Uploads/signatures, not shown.`;
  }
}

/** The aggregate-only text the model and the Brain see. */
export function aggregateReport(input: { formTitle: string; stats: FormStats }): string {
  const { stats } = input;
  const sources = stats.sources.filter((bucket) => bucket.count >= MIN_BUCKET);
  return [
    `Form: ${input.formTitle}`,
    `Complete responses: ${stats.complete}. Started but not finished: ${stats.partial}. Held out as suspected spam: ${stats.flagged}.`,
    stats.completionRate !== null ? `Completion rate: ${stats.completionRate}%.` : "",
    stats.medianSeconds !== null ? `Median time to complete: ${stats.medianSeconds} seconds.` : "",
    stats.dropOff.length ? `Drop-off (unfinished, by last page reached): ${stats.dropOff.map((item) => `page ${item.page}: ${item.count}`).join(", ")}.` : "",
    sources.length ? `Traffic sources (utm_source): ${sources.map((bucket) => `${bucket.label} ${bucket.count}`).join(", ")}.` : "",
    "",
    "Questions (complete, non-spam responses only):",
    ...stats.fields.map(fieldLine),
  ]
    .filter((line, index, all) => line !== "" || all[index - 1] !== "")
    .join("\n");
}

export function summaryPrompt(input: { brandContext: string; formTitle: string; stats: FormStats }): string {
  return `${input.brandContext}\n\nSummarize these results.\n\n${aggregateReport(input)}`;
}

export function normalizeSummary(raw: FormSummaryResult): FormSummaryResult {
  const list = (value: unknown, max: number) =>
    (Array.isArray(value) ? value : []).filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim().slice(0, 600)).slice(0, max);
  return {
    headline: typeof raw?.headline === "string" ? raw.headline.trim().slice(0, 400) : "",
    keyFindings: list(raw?.keyFindings, 8),
    questionNotes: (Array.isArray(raw?.questionNotes) ? raw.questionNotes : [])
      .filter((item) => item && typeof item.question === "string" && typeof item.note === "string")
      .map((item) => ({ question: item.question.slice(0, 300), note: item.note.slice(0, 600) }))
      .slice(0, 40),
    dataQuality: list(raw?.dataQuality, 6),
    suggestedActions: list(raw?.suggestedActions, 6),
  };
}

/** The Brain note: aggregates plus the AI summary. Never PII or verbatims. */
export function brainNote(input: { formTitle: string; brandName: string; stats: FormStats; summary: FormSummaryResult | null; generatedAt: Date }): { title: string; body: string } {
  const summary = input.summary;
  const lines = [
    `Results of the ${input.brandName} form "${input.formTitle}" as of ${input.generatedAt.toISOString().slice(0, 10)}. Aggregates only.`,
    "",
  ];
  if (summary) {
    lines.push("## Summary", "", summary.headline, "");
    if (summary.keyFindings.length) lines.push("## Key findings", "", ...summary.keyFindings.map((item) => `- ${item}`), "");
    if (summary.suggestedActions.length) lines.push("## Suggested actions", "", ...summary.suggestedActions.map((item) => `- ${item}`), "");
  }
  lines.push("## Figures", "", aggregateReport({ formTitle: input.formTitle, stats: input.stats }));
  return { title: `Form results: ${input.formTitle}`.slice(0, 200), body: lines.join("\n") };
}

export type DeleteScope = "selected" | "partial" | "flagged" | "all";

/**
 * Deleting respondent data never defaults to everything. "selected" needs
 * explicit ids; "all" needs the form's exact title typed back.
 */
export function deletionPlan(input: { scope: string; ids: string[]; confirm: string; formTitle: string }):
  | { ok: true; scope: DeleteScope; ids: string[] }
  | { ok: false; error: string } {
  const scope = input.scope as DeleteScope;
  if (!["selected", "partial", "flagged", "all"].includes(scope)) return { ok: false, error: "Choose what to delete." };
  if (scope === "selected") {
    const ids = [...new Set(input.ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))];
    if (!ids.length) return { ok: false, error: "Select the responses to delete first." };
    return { ok: true, scope, ids };
  }
  if (scope === "all" && input.confirm.trim() !== input.formTitle.trim()) {
    return { ok: false, error: "To delete every response, type the form's exact title." };
  }
  return { ok: true, scope, ids: [] };
}
