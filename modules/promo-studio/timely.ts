/**
 * Live web research for a copy package: timely hooks (news, launches,
 * decisions, studies, events) related to the promo, each with its source link.
 * The model searches the web; nothing here is a fact until an editor checks it.
 * Pure functions only: prompt, schema, cleaning and the renderings.
 */

import type { Niche } from "@pubcommand/core";

export type Finding = {
  id: string;
  headline: string;
  summary: string;
  when: string;
  whyItMatters: string;
  sourceTitle: string;
  sourceUrl: string;
  /** An editor opened the source and confirmed it. Only checked findings reach reader-facing copy. */
  checked: boolean;
};

export type ResearchAnswer = {
  findings: { headline: string; summary: string; when: string; whyItMatters: string; sourceTitle: string; sourceUrl: string }[];
};

export const MAX_FINDINGS = 8;

export const RESEARCH_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["headline", "summary", "when", "whyItMatters", "sourceTitle", "sourceUrl"],
        properties: {
          headline: { type: "string" },
          summary: { type: "string" },
          when: { type: "string" },
          whyItMatters: { type: "string" },
          sourceTitle: { type: "string" },
          sourceUrl: { type: "string" },
        },
      },
    },
  },
};

const NICHE_HOOKS: Record<Niche, string> = {
  finance: "market-moving news, company or sector events, policy and regulatory decisions, economic reports",
  health: "new studies, health guidance, product or regulatory news, seasonal health topics",
  general: "news, launches, decisions, studies, events and trends",
};

/** Stable instructions (cached). The promo and today's date go in the user message. */
export function researchSystem(niche: Niche): string {
  return `You are a research assistant for a publisher's editorial and copy team. Use web search to find current, real developments (${NICHE_HOOKS[niche]}) that are genuinely related to a promo's subject, so editors can tie their content to it.

Rules:
- Only report what you found in a search result. Every finding needs the URL of the page it came from in "sourceUrl" and that page's name in "sourceTitle". No URL, no finding.
- Recent (about the last three weeks) or clearly upcoming (about the next six weeks) only. Put the date or timeframe in "when".
- State what the source says, plainly, in "summary". Do not add numbers or claims the source does not contain.
- "whyItMatters" is one sentence connecting it to the promo's theme.
- If nothing genuinely related turns up, return an empty list. Never stretch to force a connection.
- At most ${MAX_FINDINGS} findings, most relevant first.`;
}

export function researchPrompt(input: { brandContext: string; today: string; title: string; product: string | null; bigIdea: string; summary: string; angle: string; eventName: string | null }): string {
  const subject = [
    `Promo: ${input.title}`,
    input.product ? `Product: ${input.product}` : "",
    input.bigIdea ? `Big idea: ${input.bigIdea}` : "",
    input.summary ? `Summary: ${input.summary}` : "",
    input.angle ? `Angle the team chose: ${input.angle}` : "",
    input.eventName ? `Live event: ${input.eventName}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return `${input.brandContext}\n\nToday is ${input.today}.\n\n<promo_subject>\n${subject.slice(0, 6000)}\n</promo_subject>\n\nSearch the web for timely developments related to this subject and return them with their sources.`;
}

const clean = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Keep only well-formed public http(s) source links. */
export function safeSourceUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password || !url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Drop findings without a usable source, dedupe by URL, give each a stable id. */
export function normalizeFindings(raw: unknown, previous: readonly Finding[] = []): Finding[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as ResearchAnswer).findings) ? (raw as ResearchAnswer).findings : [];
  const checkedUrls = new Set(previous.filter((f) => f.checked).map((f) => f.sourceUrl));
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const item of list) {
    const sourceUrl = safeSourceUrl(clean(item?.sourceUrl, 2000));
    const headline = clean(item?.headline, 200);
    if (!sourceUrl || !headline || seen.has(sourceUrl)) continue;
    seen.add(sourceUrl);
    out.push({
      id: `f${out.length + 1}`,
      headline,
      summary: clean(item.summary, 800),
      when: clean(item.when, 80),
      whyItMatters: clean(item.whyItMatters, 400),
      sourceTitle: clean(item.sourceTitle, 200) || new URL(sourceUrl).hostname,
      sourceUrl,
      // A re-run keeps an editor's check on the same source.
      checked: checkedUrls.has(sourceUrl),
    });
    if (out.length >= MAX_FINDINGS) break;
  }
  return out;
}

export function parseFindings(raw: unknown): Finding[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const f = item as Partial<Finding>;
    const sourceUrl = typeof f.sourceUrl === "string" ? safeSourceUrl(f.sourceUrl) : null;
    if (!sourceUrl || typeof f.id !== "string" || typeof f.headline !== "string") return [];
    return [{ id: f.id, headline: f.headline, summary: String(f.summary ?? ""), when: String(f.when ?? ""), whyItMatters: String(f.whyItMatters ?? ""), sourceTitle: String(f.sourceTitle ?? ""), sourceUrl, checked: f.checked === true }];
  });
}

/**
 * The prompt block for one component. Internal pieces (the editorial guide)
 * see every finding, marked checked or not; reader-facing copy only sees what
 * an editor confirmed.
 */
export function findingsBlock(findings: readonly Finding[], audience: "internal" | "reader"): string {
  const usable = audience === "internal" ? findings : findings.filter((f) => f.checked);
  if (!usable.length) return "";
  const lines = usable.map(
    (f) =>
      `- [${f.id}] ${f.headline}${f.when ? ` (${f.when})` : ""}: ${f.summary} Why it matters: ${f.whyItMatters} Source: ${f.sourceTitle} <${f.sourceUrl}>${audience === "internal" ? (f.checked ? " [checked by an editor]" : " [not yet checked]") : ""}`,
  );
  const rule =
    audience === "internal"
      ? "Timely developments found by web search. Refer to them by their [id] and include the source link next to each one you use. Unchecked ones are leads for the editors to confirm, so present them as such, never as settled fact."
      : "Timely developments an editor has confirmed. You may build an angle around one; state only what the line says, and add [CHECK] at the end of any sentence that uses it so the copy chief re-reads the source.";
  return `<timely_research>\n${rule}\n${lines.join("\n")}\n</timely_research>`;
}

export const SOURCES_HEADING = "**Sources (web research):**";

/** The Sources list appended to research-backed components: links come from the research, never from the AI's copy. */
export function sourcesMarkdown(findings: readonly Finding[]): string {
  if (!findings.length) return "";
  const lines = findings.map((f) => `- **${f.headline}**${f.when ? ` (${f.when})` : ""}: ${f.sourceTitle} ${f.sourceUrl}${f.checked ? "" : " _(not yet checked by an editor)_"}`);
  return `${SOURCES_HEADING}\n\n${lines.join("\n")}`;
}

/** Replace any earlier Sources block so re-generation does not stack them. */
export function withSources(content: string, findings: readonly Finding[]): string {
  const at = content.indexOf(SOURCES_HEADING);
  const base = (at >= 0 ? content.slice(0, at) : content).trimEnd();
  const block = sourcesMarkdown(findings);
  return block ? `${base}\n\n${block}` : base;
}
