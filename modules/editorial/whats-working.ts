/**
 * "What's Working": the best-performing issues of the last N days.
 *
 * The ranking and every number are computed here from the send stats. The AI
 * only explains the pattern (topics, angles, subject lines) and suggests what
 * to try next. It never supplies or changes a figure.
 */
import { addDays } from "./dates";

export type WorkingSend = {
  issueId: string;
  title: string;
  pub: string;
  day: string;
  issueType: string | null;
  writer: string | null;
  subject: string | null;
  mailed: number;
  opens: number;
  clicks: number;
  revenue: number;
};

export type PubBaseline = { code: string; sends: number; mailed: number; openRate: number | null; clickRate: number | null; revenuePerThousand: number | null };

export type RankedIssue = {
  issueId: string;
  title: string;
  pub: string;
  day: string;
  subject: string | null;
  issueType: string | null;
  writer: string | null;
  mailed: number;
  openRate: number | null;
  clickRate: number | null;
  revenuePerThousand: number | null;
  /** This send's rate ÷ its publication's weighted rate over the window (1 = typical). */
  clickLift: number | null;
  revenueLift: number | null;
  openLift: number | null;
  score: number;
};

export type WorkingFacts = {
  windowDays: number;
  from: string;
  to: string;
  sends: number;
  publications: PubBaseline[];
  top: RankedIssue[];
  /** Sends at least 50% below their publication on clicks. */
  laggards: RankedIssue[];
};

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const lift = (value: number | null, base: number | null) => (value != null && base ? value / base : null);

/** Sends smaller than this share of their publication's average are too small to rank. */
const MIN_SEND_SHARE = 0.2;

/**
 * Rank sends. Score weights click rate and revenue per 1,000 mailed most,
 * then opens, each relative to the send's own publication (so a small list
 * with an unusual rate still shows up).
 */
export function whatsWorkingFacts(all: WorkingSend[], today: string, windowDays = 30, topN = 8): WorkingFacts {
  const from = addDays(today, -windowDays);
  const sends = all.filter((s) => s.day >= from && s.day <= today && s.mailed > 0);
  const byPub = new Map<string, WorkingSend[]>();
  for (const s of sends) byPub.set(s.pub, [...(byPub.get(s.pub) ?? []), s]);
  const publications: PubBaseline[] = [...byPub.entries()]
    .map(([code, list]) => {
      const mailed = list.reduce((a, s) => a + s.mailed, 0);
      const opens = list.reduce((a, s) => a + s.opens, 0);
      const clicks = list.reduce((a, s) => a + s.clicks, 0);
      const revenue = list.reduce((a, s) => a + s.revenue, 0);
      return { code, sends: list.length, mailed, openRate: ratio(opens, mailed), clickRate: ratio(clicks, mailed), revenuePerThousand: mailed ? (revenue / mailed) * 1000 : null };
    })
    .sort((a, b) => b.mailed - a.mailed);
  const base = new Map(publications.map((p) => [p.code, p]));

  const ranked: RankedIssue[] = sends.map((s) => {
    const b = base.get(s.pub)!;
    const openRate = ratio(s.opens, s.mailed);
    const clickRate = ratio(s.clicks, s.mailed);
    const revenuePerThousand = (s.revenue / s.mailed) * 1000;
    const clickLift = lift(clickRate, b.clickRate);
    const revenueLift = lift(revenuePerThousand, b.revenuePerThousand);
    const openLift = lift(openRate, b.openRate);
    const parts: [number | null, number][] = [
      [clickLift, 0.4],
      [revenueLift, 0.4],
      [openLift, 0.2],
    ];
    const used = parts.filter(([v]) => v != null) as [number, number][];
    const weight = used.reduce((a, [, w]) => a + w, 0);
    const score = weight ? used.reduce((a, [v, w]) => a + v * w, 0) / weight : 0;
    return {
      issueId: s.issueId,
      title: s.title,
      pub: s.pub,
      day: s.day,
      subject: s.subject,
      issueType: s.issueType,
      writer: s.writer,
      mailed: s.mailed,
      openRate,
      clickRate,
      revenuePerThousand,
      clickLift,
      revenueLift,
      openLift,
      score: Math.round(score * 1000) / 1000,
    };
  });
  const bigEnough = (r: RankedIssue) => {
    const b = base.get(r.pub)!;
    return b.sends < 2 || r.mailed >= (b.mailed / b.sends) * MIN_SEND_SHARE;
  };
  const top = ranked.filter(bigEnough).sort((a, b) => b.score - a.score || b.mailed - a.mailed).slice(0, topN);
  const laggards = ranked
    .filter((r) => bigEnough(r) && r.clickLift != null && r.clickLift <= 0.5)
    .sort((a, b) => (a.clickLift ?? 0) - (b.clickLift ?? 0))
    .slice(0, 5);
  return { windowDays, from, to: today, sends: sends.length, publications, top, laggards };
}

export type WhatsWorkingAi = {
  summary: string;
  patterns: string[];
  topPerformers: { issueId: string; why: string }[];
  publications: { code: string; whatsWorking: string; recommendation: string }[];
  tryNext: string[];
};

export const WHATS_WORKING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    patterns: { type: "array", items: { type: "string" } },
    topPerformers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { issueId: { type: "string" }, why: { type: "string" } },
        required: ["issueId", "why"],
      },
    },
    publications: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { code: { type: "string" }, whatsWorking: { type: "string" }, recommendation: { type: "string" } },
        required: ["code", "whatsWorking", "recommendation"],
      },
    },
    tryNext: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "patterns", "topPerformers", "publications", "tryNext"],
} as const;

export const WHATS_WORKING_SYSTEM = `You review a publisher's recent email issues and explain why the strongest ones worked.

You receive facts computed from the publisher's own send data: each publication's weighted baseline rates and a ranked list of sends with their rates and "lift" (the send's rate divided by its publication's typical rate; 1.0 is typical, 1.5 is 50% better).

How to work:
- The ranking and every number are already decided. Do not re-rank, recompute, round differently or add figures. Refer to issues by title and publication; quote numbers only exactly as given, if at all.
- Explain the pattern: topic, angle, headline or subject-line style, issue type, writer, timing. Say what the strong sends share and how they differ from the weak ones.
- Be specific and concrete. If a publication has too few sends to judge, say so in one sentence.
- Recommendations must be things an editor can do in the next issue, and must respect the brand's reader and compliance rules.
- Plain language. Short sentences. No hype.
- topPerformers: one entry per ranked send you can explain, using its issueId exactly.
- publications: one entry per publication code given.`;

export function whatsWorkingPrompt(facts: WorkingFacts, brandContext: string): string {
  const pct = (v: number | null) => (v == null ? null : Math.round(v * 10000) / 100);
  const x = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);
  const issue = (r: RankedIssue) => ({
    issueId: r.issueId,
    title: r.title,
    publication: r.pub,
    mailDate: r.day,
    subject: r.subject,
    type: r.issueType,
    writer: r.writer,
    mailed: r.mailed,
    openRatePct: pct(r.openRate),
    clickRatePct: pct(r.clickRate),
    revenuePer1000: r.revenuePerThousand == null ? null : Math.round(r.revenuePerThousand * 100) / 100,
    clickLift: x(r.clickLift),
    revenueLift: x(r.revenueLift),
    openLift: x(r.openLift),
  });
  return [
    brandContext,
    "",
    `Window: ${facts.from} to ${facts.to} (${facts.windowDays} days, ${facts.sends} sends).`,
    "",
    "Publication baselines (weighted over the window):",
    JSON.stringify(facts.publications.map((p) => ({ code: p.code, sends: p.sends, mailed: p.mailed, openRatePct: pct(p.openRate), clickRatePct: pct(p.clickRate), revenuePer1000: p.revenuePerThousand == null ? null : Math.round(p.revenuePerThousand * 100) / 100 }))),
    "",
    "Top sends, best first:",
    JSON.stringify(facts.top.map(issue)),
    "",
    "Weakest sends on clicks:",
    JSON.stringify(facts.laggards.map(issue)),
  ].join("\n");
}

/** Keep only AI rows that refer to facts we gave it. */
export function normalizeWhatsWorking(ai: WhatsWorkingAi, facts: WorkingFacts): WhatsWorkingAi {
  const ids = new Set([...facts.top, ...facts.laggards].map((r) => r.issueId));
  const codes = new Set(facts.publications.map((p) => p.code));
  const clean = (s: unknown) => (typeof s === "string" ? s.trim() : "");
  return {
    summary: clean(ai.summary),
    patterns: (ai.patterns ?? []).map(clean).filter(Boolean).slice(0, 8),
    topPerformers: (ai.topPerformers ?? []).filter((t) => ids.has(t.issueId)).map((t) => ({ issueId: t.issueId, why: clean(t.why) })),
    publications: (ai.publications ?? []).filter((p) => codes.has(p.code)).map((p) => ({ code: p.code, whatsWorking: clean(p.whatsWorking), recommendation: clean(p.recommendation) })),
    tryNext: (ai.tryNext ?? []).map(clean).filter(Boolean).slice(0, 6),
  };
}
