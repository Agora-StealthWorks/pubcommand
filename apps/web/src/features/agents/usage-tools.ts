import { AGENT_EMAIL_DOMAIN, idleTimeoutLabel } from "@pubcommand/core";
import { appendPlatformAudit, rawPrisma } from "@pubcommand/db";
import { CONSOLE_ORG_SLUG } from "@/lib/console-workspace";
import { OPS_KINDS, getOpsNote, listOpsNotes, saveOpsNote, searchOpsNotes } from "../usage/ops-brain";
import { appUsage, clampDays, orgUsage, recentActivities, serverHealth, topUsers, usageOverview, userUsage } from "../usage/stats";
import type { AgentContext } from "./context";
import { ToolError, UUID, limit, oneOf, str, uuid, type Tool } from "./tool-kit";

/**
 * Platform agents' usage tools (read-only, plus saving Operations Brain notes): the same
 * numbers as the console's Usage page, the activity feed with content snapshots, and the
 * Operations Brain (strategic notes about how the business runs).
 */

const platform = (ctx: AgentContext) => ctx.scope === "platform";
const iso = (value: Date | string | null | undefined) => (value ? new Date(value).toISOString() : null);
const daysArg = { days: { type: "integer", minimum: 1, maximum: 365, description: "How many days back (default 30)." } };
const orgArg = { organization: { type: "string", description: "Only this organization (slug or id)." } };

async function orgFilter(value: string | undefined): Promise<{ id: string; name: string } | null> {
  const wanted = value?.trim().toLowerCase();
  if (!wanted) return null;
  const org = await rawPrisma().organization.findFirst({
    where: { OR: [{ slug: wanted }, ...(UUID.test(wanted) ? [{ id: wanted }] : [])], NOT: { slug: CONSOLE_ORG_SLUG } },
    select: { id: true, name: true },
  });
  if (!org) throw new ToolError("No organization with that slug or id. Call list_organizations.");
  return org;
}

async function personFilter(value: string | undefined): Promise<{ id: string; email: string } | null> {
  const wanted = value?.trim();
  if (!wanted) return null;
  const user = await rawPrisma().user.findFirst({
    where: { OR: [{ email: { equals: wanted, mode: "insensitive" } }, ...(UUID.test(wanted) ? [{ id: wanted }] : [])], NOT: { email: { endsWith: `@${AGENT_EMAIL_DOMAIN}` } } },
    select: { id: true, email: true },
  });
  if (!user) throw new ToolError("No person with that email or id. Call list_users or usage_people.");
  return user;
}

export const USAGE_TOOLS: Tool[] = [
  {
    name: "usage_overview",
    title: "App usage overview",
    description:
      "How PubCommand is used across every organization over the last N days: active people (today, 7d, 30d), sign-ins, time in the app, page views, things made or changed, bandwidth, the most popular apps, the most active people and organizations, and the daily trend.",
    inputSchema: { type: "object", properties: { ...daysArg }, additionalProperties: false },
    readOnly: true,
    available: platform,
    run: async (_ctx, args) => {
      const days = clampDays(args.days);
      const [overview, apps, people, orgs] = await Promise.all([usageOverview(days), appUsage(days), topUsers(days, { limit: 10 }), orgUsage(days)]);
      return {
        data: {
          ...overview,
          time_note: "activeSeconds counts only while a tab is visible with input in the last minute.",
          top_apps: apps.filter((app) => app.where === "workspace").slice(0, 10).map(({ topAreas, ...app }) => ({ ...app, busiest_pages: topAreas.slice(0, 3) })),
          top_people: people,
          organizations: orgs.slice(0, 20),
        },
      };
    },
  },
  {
    name: "usage_apps",
    title: "Usage by app",
    description: "Every app (and console page) ranked by time spent: people, views, things made or changed, AI tokens, bandwidth and the busiest pages. Filter by organization.",
    inputSchema: { type: "object", properties: { ...daysArg, ...orgArg }, additionalProperties: false },
    readOnly: true,
    available: platform,
    run: async (_ctx, args) => {
      const org = await orgFilter(str(args, "organization", 100));
      return { data: { days: clampDays(args.days), organization: org?.name ?? "all", apps: await appUsage(clampDays(args.days), { orgId: org?.id }) } };
    },
  },
  {
    name: "usage_people",
    title: "Most active people",
    description: "People ranked by time in the app: sign-ins, days active, time, page views, things made or changed, top apps and last seen. Filter by organization.",
    inputSchema: { type: "object", properties: { ...daysArg, ...orgArg, limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false },
    readOnly: true,
    available: platform,
    run: async (_ctx, args) => {
      const org = await orgFilter(str(args, "organization", 100));
      return { data: { days: clampDays(args.days), people: await topUsers(clampDays(args.days), { limit: limit(args, 25), orgId: org?.id }) } };
    },
  },
  {
    name: "user_usage",
    title: "One person's usage",
    description: "One person's sign-ins (all time and in range, recent ones with method and device), days active, time per app, things made, last active, and their idle sign-out time.",
    inputSchema: { type: "object", properties: { user: { type: "string", description: "Email or user id." }, ...daysArg }, required: ["user"], additionalProperties: false },
    readOnly: true,
    available: platform,
    run: async (_ctx, args) => {
      const person = await personFilter(str(args, "user", 200));
      if (!person) throw new ToolError("user is required.");
      const days = clampDays(args.days);
      const usage = await userUsage(person.id, days);
      const recent = await recentActivities({ days, actorId: person.id, take: 20, withContent: false });
      return { data: { email: person.email, days, ...usage, idle_sign_out: idleTimeoutLabel(usage.idleTimeoutMinutes), recent_activity: recent.map((item) => ({ at: item.at, organization: item.organization, app: item.app, summary: item.summary })) } };
    },
  },
  {
    name: "usage_activity",
    title: "What people made",
    description:
      "The activity feed: what people (and AI agents) did and made in each organization, newest first, with a text snapshot of the content (form fields, post and email copy, promo headlines and analysis). Filter by organization, app, person, verb (created, published, saved…) or words in the copy.",
    inputSchema: {
      type: "object",
      properties: {
        ...daysArg,
        ...orgArg,
        app: { type: "string", description: "App id or slug, e.g. forms, funnels, mini-blog, promo-studio." },
        user: { type: "string", description: "Email or user id." },
        verb: { type: "string" },
        query: { type: "string", description: "Words in the title or copy." },
        include_content: { type: "boolean", description: "Include the copy snapshots (default true)." },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
    readOnly: true,
    available: platform,
    run: async (_ctx, args) => {
      const [org, person] = await Promise.all([orgFilter(str(args, "organization", 100)), personFilter(str(args, "user", 200))]);
      const items = await recentActivities({
        days: clampDays(args.days, 7),
        orgId: org?.id,
        app: str(args, "app", 60)?.trim() || null,
        actorId: person?.id,
        verb: str(args, "verb", 40)?.trim() || null,
        query: str(args, "query", 200)?.trim() || null,
        take: limit(args, 40),
        withContent: args.include_content !== false,
      });
      return { data: { activity: items.map((item) => ({ ...item, content: item.content?.slice(0, 3000) ?? null })) } };
    },
  },
  {
    name: "server_health",
    title: "Servers and storage",
    description: "Web server memory and CPU (latest sample per instance, average and peak over the range, hourly peaks), the database size and its largest tables.",
    inputSchema: { type: "object", properties: { days: { type: "integer", minimum: 1, maximum: 30 } }, additionalProperties: false },
    readOnly: true,
    available: platform,
    run: async (_ctx, args) => {
      const health = await serverHealth(clampDays(args.days, 7));
      return { data: { ...health, series: health.series.slice(-72) } };
    },
  },
  {
    name: "search_operations_brain",
    title: "Search the Operations Brain",
    description: "Full-text search of the Operations Brain: strategic notes about how the business runs (marketing tactics, copy, strategy trends, how people work), written nightly from usage, plus the Reference notes on how PubCommand works today (every app, the platform, AI agents, usage). Separate from the Master Brain's marketing notes.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 50 } }, required: ["query"], additionalProperties: false },
    readOnly: true,
    available: platform,
    run: async (_ctx, args) => {
      const query = str(args, "query", 300)?.trim();
      if (!query) throw new ToolError("query is required.");
      const hits = await searchOpsNotes(query, Math.min(limit(args, 15), 50));
      return { data: { results: hits.map((hit) => ({ id: hit.id, kind: hit.kind, title: hit.title, period_start: iso(hit.periodStart), snippet: hit.snippet.replace(/[«»]/g, "") })) } };
    },
  },
  {
    name: "list_operations_brain",
    title: "List Operations Brain notes",
    description: "Operations Brain notes, newest period first: daily reads, weekly strategy notes and notes by staff or agents. kind=reference lists how PubCommand works (synced from its docs, in folders: Start here, Platform, Apps, AI agents, Usage & insights); start with \"How PubCommand works (start here)\".",
    inputSchema: { type: "object", properties: { kind: { type: "string", enum: [...OPS_KINDS] }, limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false },
    readOnly: true,
    available: platform,
    run: async (_ctx, args) => {
      const kind = oneOf(args, "kind", OPS_KINDS);
      const notes = await listOpsNotes({ kind, take: limit(args, kind === "reference" ? 100 : 20) });
      return { data: { notes: notes.map((note) => ({ id: note.id, kind: note.kind, folder: note.folder, title: note.title, period_start: iso(note.periodStart), period_end: iso(note.periodEnd), source: note.source, updated_at: iso(note.updatedAt) })) } };
    },
  },
  {
    name: "read_operations_note",
    title: "Read an Operations Brain note",
    description: "One Operations Brain note in full, with the numbers it was written from.",
    inputSchema: { type: "object", properties: { note_id: { type: "string" } }, required: ["note_id"], additionalProperties: false },
    readOnly: true,
    available: platform,
    run: async (_ctx, args) => {
      const note = await getOpsNote(uuid(args, "note_id")!);
      if (!note) throw new ToolError("No Operations Brain note with that id.");
      return { data: { id: note.id, kind: note.kind, folder: note.folder, title: note.title, body: note.body, period_start: iso(note.periodStart), period_end: iso(note.periodEnd), stats: note.stats, source: note.source, model: note.model, updated_at: iso(note.updatedAt) } };
    },
  },
  {
    name: "save_operations_note",
    title: "Save an Operations Brain note",
    description: "Add a strategic note to the Operations Brain (marketing, copy, strategy, how people work), or update one (note_id). Updating a nightly note stops the job from rewriting it.",
    inputSchema: { type: "object", properties: { title: { type: "string" }, body: { type: "string", description: "Markdown." }, note_id: { type: "string" } }, required: ["title", "body"], additionalProperties: false },
    readOnly: false,
    available: platform,
    run: async (ctx, args) => {
      const title = str(args, "title", 200)?.trim();
      const body = str(args, "body", 200_000)?.trim();
      if (!title || !body) throw new ToolError("title and body are required.");
      const noteId = uuid(args, "note_id", false);
      let saved: { id: string };
      try {
        saved = await saveOpsNote({ id: noteId, title, body, actorId: ctx.agent.userId, source: "ai-agent" });
      } catch (error) {
        throw new ToolError(error instanceof Error ? error.message : "Could not save.");
      }
      await appendPlatformAudit({ actorId: ctx.agent.userId, action: noteId ? "ops_brain.note.updated" : "ops_brain.note.created", targetType: "ops_brain_note", targetId: saved.id, metadata: { via: "ai_agent", agent: ctx.agent.name } });
      return { data: { id: saved.id, message: noteId ? "Updated." : "Saved." }, targetType: "ops_brain_note", targetId: saved.id };
    },
  },
];
