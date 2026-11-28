import { aiConfigured, runStructured } from "@pubcommand/ai";
import { formatDuration } from "@pubcommand/core";
import type { Prisma} from "@pubcommand/db";
import { platformTx, rawPrisma } from "@pubcommand/db";
import { funnelTrafficSummary } from "./funnel-traffic";
import { listOpsNotes, upsertGeneratedOpsNote } from "./ops-brain";
import { appIdentity } from "./stats";

/**
 * Writes the Operations Brain's strategic notes from what people did and made:
 * - a daily read of yesterday (New York day), and
 * - on Mondays, a weekly strategy note from the week's daily reads and numbers.
 * Notes are about marketing and the business, not the software: tactics, copy, offers,
 * strategy trends and how people work. Without an AI key a factual digest is written instead.
 */

const TZ = "America/New_York";
const MAX_ITEMS = 500;
const MAX_PROMPT_CHARS = 120_000;

/** "2026-11-24" in New York. */
export function nyDay(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** The instant a New York day starts. */
export function nyMidnight(day: string): Date {
  const guess = new Date(`${day}T05:00:00Z`);
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(guess));
  return new Date(guess.getTime() - hour * 3_600_000);
}

export function addDays(day: string, n: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

function prettyDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

type Insight = {
  title: string;
  summary: string;
  marketing_tactics: string[];
  copy_and_messaging: string[];
  strategy_trends: string[];
  user_behavior: string[];
  opportunities: string[];
  notable_work: { organization: string; what: string; why_it_matters: string }[];
};

const list = { type: "array", items: { type: "string" } };
const INSIGHT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "marketing_tactics", "copy_and_messaging", "strategy_trends", "user_behavior", "opportunities", "notable_work"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    marketing_tactics: list,
    copy_and_messaging: list,
    strategy_trends: list,
    user_behavior: list,
    opportunities: list,
    notable_work: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["organization", "what", "why_it_matters"],
        properties: { organization: { type: "string" }, what: { type: "string" }, why_it_matters: { type: "string" } },
      },
    },
  },
};

const SYSTEM = `You are the strategist who keeps PubCommand's Operations Brain: notes for the owner about how the business is really run by the people who use PubCommand (financial and health newsletter publishers and their marketers, copywriters and editors).

You read a log of what people did and made in the app (forms, funnels, promos, emails, posts, landing pages, research, calendars) with snapshots of their copy, plus usage numbers.

Write for a marketing executive, not an engineer:
- Marketing tactics: lead magnets, offers, funnels, urgency, list building, segmentation, launches, sequencing.
- Copy and messaging: headlines, hooks, promises, calls to action, angles and tone. Quote short real examples from the snapshots in quotation marks.
- Strategy trends: what themes, products, niches or campaigns are getting attention, and what is shifting.
- User behavior: how people actually work (which tools they lean on, workflows, timing, collaboration, AI agents' share).
- Opportunities: concrete ideas to grow the business and to make PubCommand more useful, grounded in what you saw.
- Notable work: the few most interesting things people built, and why they matter.

When funnel traffic is given (people only, counted per funnel), read it like a marketer: which funnels and sources (utm values) bring visitors that opt in and click the offer, how mobile-heavy the traffic is, and where viewers drop off between episodes. Put those findings under marketing tactics, strategy trends and opportunities.

Rules: only state what the log supports; say "light activity" rather than inventing. No software jargon (no table names, ids, routes, status codes, "audit"). Name organizations, not individual people or emails. Keep each bullet to one or two sentences. Empty lists are fine.`;

function bullets(items: string[]): string {
  return items.length ? items.map((item) => `- ${item.trim()}`).join("\n") : "- Nothing notable.";
}

function renderInsight(insight: Insight, numbers: string): string {
  return [
    insight.summary.trim(),
    "## Marketing tactics",
    bullets(insight.marketing_tactics),
    "## Copy and messaging",
    bullets(insight.copy_and_messaging),
    "## Strategy trends",
    bullets(insight.strategy_trends),
    "## How people work",
    bullets(insight.user_behavior),
    "## Opportunities",
    bullets(insight.opportunities),
    "## Notable work",
    insight.notable_work.length ? insight.notable_work.map((item) => `- **${item.organization}**: ${item.what} — ${item.why_it_matters}`).join("\n") : "- Nothing notable.",
    "## The numbers",
    numbers,
  ].join("\n\n");
}

type DayStats = { activeUsers: number; activeSeconds: number; views: number; logins: number; actions: number; agentActions: number; apps: { name: string; seconds: number; views: number; actions: number }[] };

async function periodStats(startDay: string, endDay: string): Promise<DayStats> {
  const start = nyMidnight(startDay);
  const end = nyMidnight(endDay);
  return platformTx(async (tx) => {
    const [usage] = await tx.$queryRaw<{ users: bigint; seconds: bigint; views: bigint }[]>`
      SELECT count(DISTINCT user_id) AS users, coalesce(sum(active_seconds), 0) AS seconds, coalesce(sum(views), 0) AS views
      FROM usage_daily WHERE day >= ${startDay}::date AND day < ${endDay}::date`;
    const apps = await tx.$queryRaw<{ app: string; seconds: bigint; views: bigint }[]>`
      SELECT app, sum(active_seconds) AS seconds, sum(views) AS views FROM usage_daily
      WHERE day >= ${startDay}::date AND day < ${endDay}::date AND site NOT IN ('admin', 'app') GROUP BY app`;
    const actionsByApp = await tx.usageActivity.groupBy({ by: ["app"], where: { createdAt: { gte: start, lt: end } }, _count: { _all: true } });
    const logins = await tx.usageLogin.count({ where: { createdAt: { gte: start, lt: end } } });
    const agentActions = await tx.usageActivity.count({ where: { createdAt: { gte: start, lt: end }, actorKind: "agent" } });
    const merged = new Map<string, { name: string; seconds: number; views: number; actions: number }>();
    const get = (raw: string) => {
      const identity = appIdentity(raw);
      const row = merged.get(identity.id) ?? { name: identity.name, seconds: 0, views: 0, actions: 0 };
      merged.set(identity.id, row);
      return row;
    };
    for (const app of apps) {
      const row = get(app.app);
      row.seconds += Number(app.seconds);
      row.views += Number(app.views);
    }
    for (const action of actionsByApp) get(action.app).actions += action._count._all;
    return {
      activeUsers: Number(usage?.users ?? 0),
      activeSeconds: Number(usage?.seconds ?? 0),
      views: Number(usage?.views ?? 0),
      logins,
      actions: actionsByApp.reduce((sum, row) => sum + row._count._all, 0),
      agentActions,
      apps: [...merged.values()].sort((a, b) => b.seconds - a.seconds || b.actions - a.actions).slice(0, 12),
    };
  });
}

function numbersText(stats: DayStats): string {
  const lines = [
    `- Active people: ${stats.activeUsers} · sign-ins: ${stats.logins} · time in the app: ${formatDuration(stats.activeSeconds)} · page views: ${stats.views}`,
    `- Things made or changed: ${stats.actions} (AI agents: ${stats.agentActions})`,
  ];
  if (stats.apps.length) lines.push(`- Apps by time: ${stats.apps.map((app) => `${app.name} ${formatDuration(app.seconds)}${app.actions ? `, ${app.actions} changes` : ""}`).join("; ")}`);
  return lines.join("\n");
}

/** The activity log as prompt text, grouped by organization and app, capped. */
async function activityLog(start: Date, end: Date): Promise<{ text: string; count: number; orgs: number }> {
  const rows = await platformTx((tx) =>
    tx.usageActivity.findMany({ where: { createdAt: { gte: start, lt: end } }, orderBy: { createdAt: "asc" }, take: MAX_ITEMS * 4 }),
  );
  const orgs = await rawPrisma().organization.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.orgId))] } }, select: { id: true, name: true } });
  const orgName = new Map(orgs.map((org) => [org.id, org.name]));
  // Collapse repeats (autosaves): keep the last entry per target and verb.
  const latest = new Map<string, (typeof rows)[number] & { times: number }>();
  for (const row of rows) {
    const key = `${row.orgId}|${row.targetType}|${row.targetId ?? row.id}|${row.verb}`;
    const prev = latest.get(key);
    latest.set(key, { ...row, times: (prev?.times ?? 0) + 1 });
  }
  const grouped = new Map<string, string[]>();
  let budget = MAX_PROMPT_CHARS;
  for (const row of [...latest.values()].slice(-MAX_ITEMS)) {
    const header = `${orgName.get(row.orgId) ?? "An organization"} · ${appIdentity(row.app).name}`;
    const who = row.actorKind === "agent" ? "AI agent" : row.actorKind === "staff" ? "PubCommand staff" : row.actorKind === "system" ? "automatic" : "member";
    const content = row.content ? `\n    ${row.content.replace(/\n/g, "\n    ").slice(0, 900)}` : "";
    const line = `- (${who}) ${row.summary}${row.times > 1 ? ` ×${row.times}` : ""}${content}`;
    if (budget - line.length < 0) break;
    budget -= line.length;
    grouped.set(header, [...(grouped.get(header) ?? []), line]);
  }
  const text = [...grouped.entries()].map(([header, lines]) => `### ${header}\n${lines.join("\n")}`).join("\n\n");
  return { text, count: rows.length, orgs: orgs.length };
}

async function writeNote(input: { key: string; kind: "daily" | "weekly"; fallbackTitle: string; prompt: string; stats: DayStats; periodStart: Date; periodEnd: Date; fallbackBody: string; funnels?: string }) {
  const numbers = input.funnels ? `${numbersText(input.stats)}\n\n### Funnel traffic\n\n${input.funnels}` : numbersText(input.stats);
  let title = input.fallbackTitle;
  let body = `${input.fallbackBody}\n\n## The numbers\n\n${numbers}`;
  let model: string | null = null;
  let ai: "ok" | "unavailable" | "failed" = "unavailable";
  if (aiConfigured()) {
    const result = await runStructured<Insight>({ system: SYSTEM, input: [{ type: "text", text: input.prompt }], schema: INSIGHT_SCHEMA, effort: "medium", maxTokens: 12_000 });
    if (result.status === "ok") {
      ai = "ok";
      model = result.usage.model;
      title = `${input.fallbackTitle}: ${result.data.title.trim()}`.slice(0, 200);
      body = renderInsight(result.data, numbers);
      console.info("[usage] insight usage", JSON.stringify(result.usage));
    } else {
      ai = "failed";
      console.warn("[usage] insight AI failed", result.reason);
    }
  }
  const outcome = await upsertGeneratedOpsNote({
    key: input.key,
    kind: input.kind,
    title,
    body,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    stats: input.stats as unknown as Prisma.InputJsonValue,
    model,
  });
  return { outcome, ai };
}

/** Yesterday's (or `day`'s) daily read. Skipped when nobody used the app that day. */
export async function writeDailyInsight(day: string): Promise<{ day: string; outcome: string; ai?: string; activities?: number }> {
  const start = nyMidnight(day);
  const end = nyMidnight(addDays(day, 1));
  const stats = await periodStats(day, addDays(day, 1));
  const funnels = await funnelTrafficSummary(start, end);
  if (stats.actions === 0 && stats.activeUsers === 0 && stats.logins === 0 && !funnels) return { day, outcome: "skipped (no activity)" };
  const log = await activityLog(start, end);
  const prompt = `Day: ${prettyDay(day)} (New York time).\n\nUsage numbers:\n${numbersText(stats)}\n\n${funnels ? `Funnel traffic (visitors to the public funnel pages; people only):\n${funnels}\n\n` : ""}What people did and made (${log.count} entries across ${log.orgs} organizations):\n\n${log.text || "(no changes recorded; people only browsed)"}\n\nWrite the daily read. The title is a short headline for the day (under 10 words).`;
  const fallbackBody = log.text ? `What people did and made:\n\n${log.text.slice(0, 40_000)}` : "People browsed but did not make or change anything.";
  const result = await writeNote({ key: `daily:${day}`, kind: "daily", fallbackTitle: `Daily read · ${prettyDay(day)}`, prompt, stats, periodStart: start, periodEnd: end, fallbackBody, funnels });
  return { day, ...result, activities: log.count };
}

/** The weekly strategy note for the 7 days starting `weekStart` (a Monday). */
export async function writeWeeklyInsight(weekStart: string): Promise<{ week: string; outcome: string; ai?: string }> {
  const weekEnd = addDays(weekStart, 7);
  const start = nyMidnight(weekStart);
  const end = nyMidnight(weekEnd);
  const stats = await periodStats(weekStart, weekEnd);
  const funnels = await funnelTrafficSummary(start, end);
  if (stats.actions === 0 && stats.activeUsers === 0 && !funnels) return { week: weekStart, outcome: "skipped (no activity)" };
  const dailies = await platformTx((tx) =>
    tx.opsBrainNote.findMany({ where: { kind: "daily", deletedAt: null, periodStart: { gte: start, lt: end } }, orderBy: { periodStart: "asc" }, select: { title: true, body: true } }),
  );
  const previous = (await listOpsNotes({ kind: "weekly", take: 2, before: start }))[0];
  const previousBody = previous ? await platformTx((tx) => tx.opsBrainNote.findUnique({ where: { id: previous.id }, select: { body: true } })) : null;
  const log = dailies.length ? null : await activityLog(start, end);
  const prompt = [
    `Week of ${prettyDay(weekStart)} (New York time).`,
    `Usage numbers for the week:\n${numbersText(stats)}`,
    funnels ? `Funnel traffic for the week (people only):\n${funnels}` : "",
    dailies.length ? `The week's daily reads:\n\n${dailies.map((note) => `# ${note.title}\n${note.body}`).join("\n\n").slice(0, MAX_PROMPT_CHARS)}` : `What people did and made:\n\n${log?.text ?? ""}`,
    previousBody ? `Last week's strategy note (to compare against and spot shifts):\n\n${previousBody.body.slice(0, 12_000)}` : "",
    "Write the weekly strategy note: the trends across the week and what changed from last week. The title is a short headline for the week (under 10 words).",
  ]
    .filter(Boolean)
    .join("\n\n");
  const fallbackBody = dailies.length ? dailies.map((note) => `- ${note.title}`).join("\n") : "Light activity this week.";
  const result = await writeNote({ key: `weekly:${weekStart}`, kind: "weekly", fallbackTitle: `Week of ${prettyDay(weekStart)}`, prompt, stats, periodStart: start, periodEnd: end, fallbackBody, funnels });
  return { week: weekStart, ...result };
}

/** The job: yesterday's daily read; on Mondays also last week's strategy note. */
export async function runInsights(now: Date = new Date()): Promise<Record<string, unknown>> {
  const today = nyDay(now);
  const yesterday = addDays(today, -1);
  const daily = await writeDailyInsight(yesterday);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const weekly = weekday === 1 ? await writeWeeklyInsight(addDays(today, -7)) : null;
  return { daily, ...(weekly ? { weekly } : {}) };
}
