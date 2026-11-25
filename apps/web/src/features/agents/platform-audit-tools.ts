import { buildSiteUrl } from "@pubcommand/core";
import { Prisma, platformTx, rawPrisma } from "@pubcommand/db";
import { rootDomain } from "@/lib/auth";
import { CONSOLE_ORG_SLUG } from "@/lib/console-workspace";
import type { AgentContext } from "./context";
import { ToolError, UUID, limit, str, type Tool } from "./tool-kit";

/**
 * Platform agents' wide-angle tools: read any record on the platform, review security and
 * performance, and audit specific forms, funnels and public pages. Read-only.
 *
 * Secrets never leave: password hashes, token and key hashes, 2FA secrets, unlock keys, login
 * sessions and file bytes are neither returned nor usable in a filter (a filter could probe them).
 */

const platform = (ctx: AgentContext) => ctx.scope === "platform";
const DAY = 86_400_000;
const iso = (date: Date | null | undefined) => (date ? date.toISOString() : null);

// ── Schema-aware record reader ──────────────────────────────────────────────

/** Field names that hold secrets (or values that work like passwords). */
export const SENSITIVE_FIELD = /(password|secret|cipher|hash|totp|^token$|key$)/i;
/** Models that are secrets as a whole (a Session id is a login cookie). */
const BLOCKED_MODELS = new Set(["Session"]);

type DmmfField = { name: string; kind: string; type: string; isList: boolean; relationName?: string | null };
type DmmfModel = { name: string; fields: readonly DmmfField[] };

function models(): readonly DmmfModel[] {
  return Prisma.dmmf.datamodel.models as unknown as readonly DmmfModel[];
}

function findModel(name: string): DmmfModel {
  const wanted = name.trim().toLowerCase();
  const model = models().find((m) => m.name.toLowerCase() === wanted);
  if (!model || BLOCKED_MODELS.has(model.name)) throw new ToolError(`No readable model "${name}". Call describe_data for the list.`);
  return model;
}

/** Scalar fields an agent may read and filter on. */
export function readableFields(model: DmmfModel): DmmfField[] {
  return model.fields.filter((field) => (field.kind === "scalar" || field.kind === "enum") && field.type !== "Bytes" && !SENSITIVE_FIELD.test(field.name));
}

const OPERATORS = new Set(["equals", "in", "notIn", "lt", "lte", "gt", "gte", "contains", "startsWith", "endsWith", "mode", "not", "has", "hasSome", "hasEvery", "isEmpty", "search"]);
const RELATION_OPERATORS = new Set(["some", "every", "none", "is", "isNot"]);

/** Checks a Prisma where object: only readable fields, known operators, relations followed into their model. */
export function checkWhere(model: DmmfModel, where: unknown, depth = 0): void {
  if (depth > 6) throw new ToolError("The filter is nested too deeply.");
  if (where === null || typeof where !== "object" || Array.isArray(where)) throw new ToolError("where must be an object.");
  for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
    if (key === "AND" || key === "OR" || key === "NOT") {
      for (const part of Array.isArray(value) ? value : [value]) checkWhere(model, part, depth + 1);
      continue;
    }
    const field = model.fields.find((f) => f.name === key);
    if (!field) throw new ToolError(`${model.name} has no field "${key}". Call describe_data with model "${model.name}".`);
    if (field.kind === "object") {
      const related = findModel(field.type);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const entries = Object.entries(value as Record<string, unknown>);
        const viaOperator = entries.length > 0 && entries.every(([k]) => RELATION_OPERATORS.has(k));
        if (viaOperator) for (const [, inner] of entries) checkWhere(related, inner ?? {}, depth + 1);
        else checkWhere(related, value, depth + 1);
      }
      continue;
    }
    if (SENSITIVE_FIELD.test(field.name) || field.type === "Bytes") throw new ToolError(`${model.name}.${field.name} holds secrets and cannot be filtered on.`);
    if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
      for (const op of Object.keys(value as Record<string, unknown>)) if (!OPERATORS.has(op)) throw new ToolError(`Unknown filter operator "${op}" on ${model.name}.${field.name}.`);
    }
  }
}

function jsonSafe(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => {
      if (typeof v === "bigint") return Number(v);
      if (typeof v === "string" && v.length > 4000) return `${v.slice(0, 4000)}… (${v.length} characters)`;
      return v;
    }),
  );
}

function delegate(tx: Prisma.TransactionClient, model: DmmfModel) {
  const name = model.name.charAt(0).toLowerCase() + model.name.slice(1);
  return (tx as unknown as Record<string, { findMany: (args: unknown) => Promise<unknown[]>; count: (args: unknown) => Promise<number> }>)[name]!;
}

async function organizationFilter(model: DmmfModel, value: unknown): Promise<Record<string, unknown>> {
  if (value === undefined || value === null || value === "") return {};
  if (typeof value !== "string") throw new ToolError("organization must be a slug or id.");
  const wanted = value.trim().toLowerCase();
  const org = await rawPrisma().organization.findFirst({ where: { OR: [{ slug: wanted }, ...(UUID.test(wanted) ? [{ id: wanted }] : [])] }, select: { id: true } });
  if (!org) throw new ToolError("No organization with that slug or id.");
  if (model.name === "Organization") return { id: org.id };
  if (!model.fields.some((f) => f.name === "organizationId")) throw new ToolError(`${model.name} does not belong to an organization; leave organization out.`);
  return { organizationId: org.id };
}

// ── Page audit helpers ──────────────────────────────────────────────────────

/** Only PubCommand's own hosts and customers' connected domains: never an arbitrary address. */
async function allowedPageUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ToolError("url must be a full address, e.g. https://acme.pubcommand.com/w/site/post.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new ToolError("url must start with https://");
  const root = rootDomain().toLowerCase();
  const host = url.hostname.toLowerCase();
  if (host === root || host.endsWith(`.${root}`)) return url;
  const custom = await platformTx((tx) => tx.customDomain.findFirst({ where: { hostname: host, status: "ACTIVE" }, select: { id: true } }));
  if (custom) return url;
  throw new ToolError(`Only PubCommand pages can be audited (${root}, its subdomains, and connected custom domains).`);
}

function matchAll(html: string, re: RegExp): RegExpExecArray[] {
  return [...html.matchAll(re)];
}

async function timedFetch(url: string, method: "GET" | "HEAD", timeoutMs = 10_000) {
  const started = performance.now();
  const response = await fetch(url, { method, redirect: "manual", signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": "PubCommand-Agent-Audit/1.0" } });
  return { response, ms: Math.round(performance.now() - started) };
}

type Finding = { severity: "high" | "medium" | "low" | "info"; finding: string };

// ── Tools ───────────────────────────────────────────────────────────────────

export const PLATFORM_AUDIT_TOOLS: Tool[] = [
  {
    name: "describe_data",
    title: "Describe the data",
    description: "Without model: every kind of record on the platform (models) with its field count. With model: its readable fields and relations, for query_records.",
    inputSchema: { type: "object", properties: { model: { type: "string" } }, additionalProperties: false },
    readOnly: true,
    available: platform,
    run: async (_ctx, args) => {
      const name = str(args, "model", 80)?.trim();
      if (!name) {
        return { data: { models: models().filter((m) => !BLOCKED_MODELS.has(m.name)).map((m) => ({ model: m.name, fields: readableFields(m).length, per_organization: m.fields.some((f) => f.name === "organizationId") })) } };
      }
      const model = findModel(name);
      return {
        data: {
          model: model.name,
          fields: readableFields(model).map((f) => `${f.name}: ${f.type}${f.isList ? "[]" : ""}`),
          relations: model.fields.filter((f) => f.kind === "object" && !BLOCKED_MODELS.has(f.type)).map((f) => `${f.name} → ${f.type}${f.isList ? "[]" : ""}`),
          hidden: model.fields.filter((f) => (f.kind === "scalar" && (f.type === "Bytes" || SENSITIVE_FIELD.test(f.name))) || BLOCKED_MODELS.has(f.type)).map((f) => f.name),
        },
      };
    },
  },
  {
    name: "query_records",
    title: "Read records",
    description:
      "Read any records on the platform (any organization): pass a model (see describe_data), an optional Prisma-style where filter, fields, order_by and limit. Secrets (password/token/key hashes, 2FA secrets, sessions, file bytes) are never returned.",
    inputSchema: {
      type: "object",
      properties: {
        model: { type: "string", description: "e.g. Form, Funnel, WebPost, Organization, AuditLog." },
        organization: { type: "string", description: "Only this organization (slug or id)." },
        where: { type: "object", description: 'Prisma where, e.g. {"status":"OPEN","title":{"contains":"gold","mode":"insensitive"}}.' },
        fields: { type: "array", items: { type: "string" }, description: "Fields to return (default: all readable)." },
        order_by: { type: "object", description: 'e.g. {"createdAt":"desc"}' },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        offset: { type: "integer", minimum: 0 },
      },
      required: ["model"],
      additionalProperties: false,
    },
    readOnly: true,
    available: platform,
    run: async (_ctx, args) => {
      const model = findModel(str(args, "model", 80) ?? "");
      const readable = readableFields(model);
      const wanted = Array.isArray(args.fields) ? (args.fields as unknown[]).map(String) : null;
      const fields = wanted ? readable.filter((f) => wanted.includes(f.name)) : readable;
      if (wanted && fields.length !== wanted.length) throw new ToolError(`Unknown or hidden fields: ${wanted.filter((w) => !readable.some((f) => f.name === w)).join(", ")}.`);
      const where = args.where ?? {};
      checkWhere(model, where);
      const orderBy = args.order_by;
      if (orderBy !== undefined) {
        if (!orderBy || typeof orderBy !== "object" || Array.isArray(orderBy)) throw new ToolError('order_by must be like {"createdAt":"desc"}.');
        for (const [key, dir] of Object.entries(orderBy as Record<string, unknown>)) {
          if (!readable.some((f) => f.name === key) || (dir !== "asc" && dir !== "desc")) throw new ToolError(`Cannot order ${model.name} by "${key}".`);
        }
      }
      const scope = await organizationFilter(model, args.organization);
      const offset = Math.max(0, Math.min(10_000, Number(args.offset ?? 0) || 0));
      const rows = await platformTx((tx) =>
        delegate(tx, model).findMany({
          where: { AND: [where, scope] },
          select: Object.fromEntries(fields.map((f) => [f.name, true])),
          ...(orderBy ? { orderBy } : {}),
          take: limit(args, 25),
          skip: offset,
        }),
      ).catch((error: unknown) => {
        throw new ToolError(`The query failed: ${error instanceof Error ? error.message.split("\n").filter(Boolean).slice(-1)[0]?.slice(0, 300) : "unknown error"}`);
      });
      return { data: { model: model.name, count: rows.length, offset, rows: jsonSafe(rows) } };
    },
  },
  {
    name: "count_records",
    title: "Count records",
    description: "How many records of a model match a filter (same where as query_records), optionally for one organization.",
    inputSchema: { type: "object", properties: { model: { type: "string" }, organization: { type: "string" }, where: { type: "object" } }, required: ["model"], additionalProperties: false },
    readOnly: true,
    available: platform,
    run: async (_ctx, args) => {
      const model = findModel(str(args, "model", 80) ?? "");
      const where = args.where ?? {};
      checkWhere(model, where);
      const scope = await organizationFilter(model, args.organization);
      const count = await platformTx((tx) => delegate(tx, model).count({ where: { AND: [where, scope] } })).catch((error: unknown) => {
        throw new ToolError(`The count failed: ${error instanceof Error ? error.message.split("\n").filter(Boolean).slice(-1)[0]?.slice(0, 300) : "unknown error"}`);
      });
      return { data: { model: model.name, count } };
    },
  },
  {
    name: "security_review",
    title: "Security review",
    description: "Reviews the platform's security: settings, staff 2FA, row-level security on every organization table, sign-in exposure, AI agent keys, compliance gaps on public forms, and recent sensitive staff actions. Returns findings by severity.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    readOnly: true,
    available: platform,
    run: async () => {
      const findings: Finding[] = [];
      const add = (severity: Finding["severity"], finding: string) => findings.push({ severity, finding });
      const env = process.env;
      if (env.REQUIRE_STAFF_2FA !== "true") add("high", "Staff two-factor is off (REQUIRE_STAFF_2FA is not true): a staff password alone opens the admin console.");
      if (env.AUTH_DEV_EXPOSE_LINKS) add("high", "AUTH_DEV_EXPOSE_LINKS is set: sign-in links can show on the page. It must be unset in production.");
      if ((env.AUTH_SECRET ?? "").length < 32) add("medium", "AUTH_SECRET is shorter than 32 characters.");
      if (env.EMAIL_LOGIN_ENABLED === "true" && !env.RESEND_API_KEY) add("medium", "Email sign-in is on but RESEND_API_KEY is not set: sign-in links only go to server logs.");
      if (env.NODE_ENV !== "production") add("info", `NODE_ENV is ${env.NODE_ENV ?? "unset"} (secure cookies need production).`);

      const db = rawPrisma();
      const now = new Date();
      const [staff, rls, liveMagicLinks, disabledWithSessions, sessions, oldUnusedKeys, adminAgents, ownerless, sensitive, openForms] = await Promise.all([
        db.platformStaff.findMany({ where: { disabledAt: null }, include: { user: { select: { email: true } } } }),
        db.$queryRaw<{ table_name: string; rls: boolean; forced: boolean }[]>`
          SELECT c.relname AS table_name, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r'
            AND EXISTS (SELECT 1 FROM information_schema.columns col WHERE col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'organization_id')`,
        db.magicLink.count({ where: { consumedAt: null, expiresAt: { gt: now } } }),
        db.user.count({ where: { disabledAt: { not: null }, sessions: { some: { expiresAt: { gt: now } } } } }),
        db.session.count({ where: { expiresAt: { gt: now } } }),
        platformTx((tx) => tx.aiAgentToken.count({ where: { kind: "key", revokedAt: null, OR: [{ lastUsedAt: null, createdAt: { lt: new Date(now.getTime() - 30 * DAY) } }, { lastUsedAt: { lt: new Date(now.getTime() - 90 * DAY) } }] } })),
        platformTx((tx) => tx.aiAgent.findMany({ where: { scope: "platform", removedAt: null, allowAdminActions: true }, select: { name: true } })),
        platformTx((tx) => tx.$queryRaw<{ name: string; org: string }[]>`
          SELECT a.name, o.slug AS org FROM ai_agents a JOIN organizations o ON o.id = a.organization_id
          WHERE a.scope = 'organization' AND a.removed_at IS NULL AND a.paused_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = a.organization_id AND m.user_id = a.owner_user_id AND m.status = 'ACTIVE')`),
        db.platformAuditLog.findMany({
          where: { createdAt: { gte: new Date(now.getTime() - 7 * DAY) }, OR: [{ action: { contains: "delete" } }, { action: { contains: "purge" } }, { action: { contains: "impersonation" } }, { action: { contains: "password" } }, { action: { contains: "staff" } }] },
          orderBy: { createdAt: "desc" },
          take: 20,
        }),
        platformTx((tx) => tx.form.findMany({ where: { status: "OPEN" }, select: { title: true, slug: true, organizationId: true, theme: { select: { privacyPolicyUrl: true } } } })),
      ]);
      const no2fa = staff.filter((s) => !s.totpConfirmedAt);
      if (no2fa.length) add(env.REQUIRE_STAFF_2FA === "true" ? "high" : "medium", `${no2fa.length} active staff without 2FA set up: ${no2fa.map((s) => `${s.user.email} (${s.role})`).join(", ")}.`);
      const superAdmins = staff.filter((s) => s.role === "SUPER_ADMIN").length;
      add("info", `${staff.length} active staff, ${superAdmins} super admin${superAdmins === 1 ? "" : "s"}.`);
      const weak = rls.filter((row) => !row.rls || !row.forced);
      if (weak.length) add("high", `Organization tables without forced row-level security: ${weak.map((row) => row.table_name).join(", ")}.`);
      else add("info", `All ${rls.length} organization tables have forced row-level security.`);
      if (disabledWithSessions) add("high", `${disabledWithSessions} disabled account(s) still have live sessions.`);
      add("info", `${sessions} live sessions; ${liveMagicLinks} unused sign-in/reset links not yet expired.`);
      if (oldUnusedKeys) add("medium", `${oldUnusedKeys} AI agent API key(s) unused for a long time (never used in 30 days, or idle 90 days): revoke them in AI Agents.`);
      if (adminAgents.length) add("info", `Platform agents allowed to make admin changes: ${adminAgents.map((a) => a.name).join(", ")}.`);
      if (ownerless.length) add("low", `Agents whose owner is no longer an active member (they are refused, but still listed): ${ownerless.map((a) => `${a.name} (${a.org})`).join(", ")}.`);
      const noPrivacy = openForms.filter((form) => !form.theme?.privacyPolicyUrl);
      if (noPrivacy.length) add("medium", `${noPrivacy.length} open form(s) without a privacy-policy link (compliance): ${noPrivacy.slice(0, 10).map((f) => f.slug).join(", ")}${noPrivacy.length > 10 ? "…" : ""}.`);
      if (sensitive.length) add("info", `Sensitive staff actions in the last 7 days: ${sensitive.map((row) => `${row.action} (${row.createdAt.toISOString().slice(0, 10)})`).join("; ")}.`);
      const order = { high: 0, medium: 1, low: 2, info: 3 };
      findings.sort((a, b) => order[a.severity] - order[b.severity]);
      return { data: { reviewed_at: now.toISOString(), findings } };
    },
  },
  {
    name: "performance_review",
    title: "Performance review",
    description: "The app's performance: database size, largest and most-scanned tables, unused indexes, connections and long-running queries, background job durations and failures, AI agent tool latency, and the server process.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    readOnly: true,
    available: platform,
    run: async () => {
      const db = rawPrisma();
      const since = new Date(Date.now() - 7 * DAY);
      const num = (v: unknown) => (typeof v === "bigint" ? Number(v) : typeof v === "string" ? Number(v) : (v as number));
      const [size, tables, scans, unusedIndexes, connections, longQueries, jobs, tools] = await Promise.all([
        db.$queryRaw<{ bytes: bigint }[]>`SELECT pg_database_size(current_database()) AS bytes`,
        db.$queryRaw<{ table_name: string; bytes: bigint; rows: bigint }[]>`
          SELECT relname AS table_name, pg_total_relation_size(relid) AS bytes, n_live_tup AS rows
          FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 12`,
        db.$queryRaw<{ table_name: string; seq_scan: bigint; idx_scan: bigint | null; rows: bigint }[]>`
          SELECT relname AS table_name, seq_scan, idx_scan, n_live_tup AS rows FROM pg_stat_user_tables
          WHERE n_live_tup > 5000 AND seq_scan > COALESCE(idx_scan, 0) ORDER BY seq_scan DESC LIMIT 10`,
        db.$queryRaw<{ index_name: string; table_name: string; bytes: bigint }[]>`
          SELECT indexrelname AS index_name, relname AS table_name, pg_relation_size(indexrelid) AS bytes
          FROM pg_stat_user_indexes WHERE idx_scan = 0 AND pg_relation_size(indexrelid) > 1048576 ORDER BY pg_relation_size(indexrelid) DESC LIMIT 10`,
        db.$queryRaw<{ state: string | null; count: bigint }[]>`SELECT state, count(*) AS count FROM pg_stat_activity WHERE datname = current_database() GROUP BY state`,
        db.$queryRaw<{ seconds: number; state: string | null; query: string }[]>`
          SELECT EXTRACT(EPOCH FROM now() - query_start)::float AS seconds, state, left(query, 200) AS query
          FROM pg_stat_activity WHERE datname = current_database() AND state <> 'idle' AND query_start < now() - interval '30 seconds' ORDER BY query_start LIMIT 5`,
        db.jobRun.groupBy({ by: ["job", "status"], where: { startedAt: { gte: since } }, _count: { _all: true }, _avg: { durationMs: true }, _max: { durationMs: true } }),
        platformTx((tx) => tx.aiAgentCall.groupBy({ by: ["tool"], where: { createdAt: { gte: new Date(Date.now() - DAY) } }, _count: { _all: true }, _avg: { durationMs: true }, _max: { durationMs: true } })),
      ]);
      let topStatements: unknown = "pg_stat_statements is not enabled on this database.";
      try {
        topStatements = jsonSafe(
          await db.$queryRawUnsafe(`SELECT left(query, 160) AS query, calls, round(mean_exec_time::numeric, 1) AS mean_ms, round(total_exec_time::numeric) AS total_ms FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10`),
        );
      } catch {
        // Extension missing: say so above.
      }
      const jobSummary = new Map<string, { runs: number; failed: number; avg_ms: number | null; max_ms: number | null }>();
      for (const row of jobs) {
        const entry = jobSummary.get(row.job) ?? { runs: 0, failed: 0, avg_ms: null, max_ms: null };
        entry.runs += row._count._all;
        if (row.status === "failed") entry.failed += row._count._all;
        entry.avg_ms = Math.max(entry.avg_ms ?? 0, Math.round(row._avg.durationMs ?? 0)) || entry.avg_ms;
        entry.max_ms = Math.max(entry.max_ms ?? 0, row._max.durationMs ?? 0) || entry.max_ms;
        jobSummary.set(row.job, entry);
      }
      const memory = process.memoryUsage();
      const mb = (bytes: number) => Math.round(bytes / 1048576);
      return {
        data: {
          database: {
            size_mb: mb(num(size[0]?.bytes ?? 0)),
            largest_tables: tables.map((t) => ({ table: t.table_name, size_mb: mb(num(t.bytes)), rows: num(t.rows) })),
            tables_scanned_without_index: scans.map((t) => ({ table: t.table_name, seq_scans: num(t.seq_scan), index_scans: num(t.idx_scan ?? 0), rows: num(t.rows) })),
            unused_indexes_over_1mb: unusedIndexes.map((i) => ({ index: i.index_name, table: i.table_name, size_mb: mb(num(i.bytes)) })),
            connections: Object.fromEntries(connections.map((c) => [c.state ?? "unknown", num(c.count)])),
            queries_running_over_30s: longQueries,
            slowest_statements: topStatements,
          },
          jobs_last_7_days: [...jobSummary.entries()].map(([job, s]) => ({ job, ...s, failure_rate: s.runs ? Math.round((s.failed / s.runs) * 100) / 100 : 0 })).sort((a, b) => (b.max_ms ?? 0) - (a.max_ms ?? 0)),
          agent_tools_last_24h: tools.map((t) => ({ tool: t.tool, calls: t._count._all, avg_ms: Math.round(t._avg.durationMs ?? 0), max_ms: t._max.durationMs ?? 0 })).sort((a, b) => b.avg_ms - a.avg_ms),
          server: {
            uptime_minutes: Math.round(process.uptime() / 60),
            memory_mb: { rss: mb(memory.rss), heap_used: mb(memory.heapUsed), heap_total: mb(memory.heapTotal) },
            node: process.version,
            release: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
            region: process.env.RAILWAY_REPLICA_REGION ?? null,
          },
        },
      };
    },
  },
  {
    name: "audit_form",
    title: "Audit a form",
    description: "One form in any organization (slug or id): its settings, theme, fields, response counts, public link, and problems found.",
    inputSchema: { type: "object", properties: { organization: { type: "string" }, form: { type: "string", description: "Form slug or id." } }, required: ["organization", "form"], additionalProperties: false },
    readOnly: true,
    available: platform,
    run: async (_ctx, args) => {
      const org = await rawPrisma().organization.findFirst({ where: { OR: [{ slug: (str(args, "organization", 100) ?? "").toLowerCase() }, ...(UUID.test(str(args, "organization", 100) ?? "") ? [{ id: str(args, "organization", 100)! }] : [])], NOT: { slug: CONSOLE_ORG_SLUG } }, select: { id: true, slug: true } });
      if (!org) throw new ToolError("No organization with that slug or id.");
      const wanted = (str(args, "form", 120) ?? "").trim();
      const result = await platformTx(async (tx) => {
        const form = await tx.form.findFirst({ where: { organizationId: org.id, deletedAt: null, OR: [{ slug: wanted.toLowerCase() }, ...(UUID.test(wanted) ? [{ id: wanted }] : [])] }, include: { theme: true } });
        if (!form) return null;
        const since = new Date(Date.now() - 30 * DAY);
        const [fields, responses, recent, last] = await Promise.all([
          tx.formField.findMany({ where: { formId: form.id }, orderBy: { position: "asc" } }),
          tx.formResponse.count({ where: { formId: form.id } }),
          tx.formResponse.count({ where: { formId: form.id, createdAt: { gte: since } } }),
          tx.formResponse.findFirst({ where: { formId: form.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
        ]);
        return { form, fields, responses, recent, last };
      });
      if (!result) throw new ToolError("No form with that slug or id in that organization.");
      const { form, fields, responses, recent, last } = result;
      const findings: Finding[] = [];
      const now = new Date();
      if (form.status === "OPEN" && fields.length === 0) findings.push({ severity: "high", finding: "Open, but has no fields." });
      if (form.status === "OPEN" && form.closesAt && form.closesAt < now) findings.push({ severity: "medium", finding: `Marked open but its close date passed (${iso(form.closesAt)}).` });
      if (!form.theme) findings.push({ severity: "medium", finding: "No theme: the public form has no header and no privacy-policy link." });
      else if (!form.theme.privacyPolicyUrl) findings.push({ severity: "medium", finding: `Theme "${form.theme.name}" has no privacy-policy link (required for compliance).` });
      if (form.redirectUrl && !/^https:\/\//i.test(form.redirectUrl)) findings.push({ severity: "low", finding: `The redirect after submit is not https: ${form.redirectUrl}` });
      if (form.responseLimit && responses >= form.responseLimit) findings.push({ severity: "medium", finding: `Response limit reached (${responses}/${form.responseLimit}): new visitors see the closed message.` });
      if (form.status === "OPEN" && responses > 0 && recent === 0) findings.push({ severity: "info", finding: "Open, but no responses in 30 days." });
      if (!fields.some((f) => /email/i.test(String((f as Record<string, unknown>).type ?? "")) || /email/i.test(String((f as Record<string, unknown>).label ?? "")))) findings.push({ severity: "info", finding: "No email field." });
      const field = (f: Record<string, unknown>) => ({ label: f.label ?? null, type: f.type ?? null, required: f.required ?? null });
      return {
        data: {
          form: { id: form.id, title: form.title, slug: form.slug, status: form.status, opens_at: iso(form.opensAt), closes_at: iso(form.closesAt), response_limit: form.responseLimit, layout: form.layout, redirect_url: form.redirectUrl },
          public_url: buildSiteUrl({ rootDomain: rootDomain(), requestHost: `app.${rootDomain()}`, site: { kind: "org", slug: org.slug }, pathname: `/f/${form.slug}` }),
          theme: form.theme ? { name: form.theme.name, follows_brand: form.theme.followBrand, privacy_policy_url: form.theme.privacyPolicyUrl, header_color: form.theme.barColor, button_color: form.theme.accentColor } : null,
          fields: fields.map((f) => field(f as unknown as Record<string, unknown>)),
          responses: { total: responses, last_30_days: recent, last: iso(last?.createdAt) },
          findings,
        },
        targetType: "form",
        targetId: form.id,
      };
    },
  },
  {
    name: "audit_funnel",
    title: "Audit a funnel",
    description: "One launch funnel / video series in any organization (slug or id): its schedule, days and videos, opt-ins, look, public link, and problems found.",
    inputSchema: { type: "object", properties: { organization: { type: "string" }, funnel: { type: "string", description: "Funnel slug or id." } }, required: ["organization", "funnel"], additionalProperties: false },
    readOnly: true,
    available: platform,
    run: async (_ctx, args) => {
      const orgValue = (str(args, "organization", 100) ?? "").trim().toLowerCase();
      const org = await rawPrisma().organization.findFirst({ where: { OR: [{ slug: orgValue }, ...(UUID.test(orgValue) ? [{ id: orgValue }] : [])], NOT: { slug: CONSOLE_ORG_SLUG } }, select: { id: true, slug: true } });
      if (!org) throw new ToolError("No organization with that slug or id.");
      const wanted = (str(args, "funnel", 120) ?? "").trim();
      const result = await platformTx(async (tx) => {
        const funnel = await tx.funnel.findFirst({ where: { organizationId: org.id, OR: [{ slug: wanted.toLowerCase() }, ...(UUID.test(wanted) ? [{ id: wanted }] : [])] } });
        if (!funnel) return null;
        const [days, optins, events] = await Promise.all([
          tx.funnelDay.findMany({ where: { funnelId: funnel.id }, orderBy: { position: "asc" }, select: { position: true, title: true, videoProvider: true, videoId: true, unlockAt: true, unlockOffsetHours: true, isLive: true, liveStartAt: true } }),
          tx.funnelOptin.count({ where: { funnelId: funnel.id } }),
          tx.funnelEvent.count({ where: { funnelId: funnel.id, createdAt: { gte: new Date(Date.now() - 7 * DAY) } } }),
        ]);
        return { funnel, days, optins, events };
      });
      if (!result) throw new ToolError("No funnel with that slug or id in that organization.");
      const { funnel, days, optins, events } = result;
      const findings: Finding[] = [];
      const now = new Date();
      if (days.length === 0) findings.push({ severity: "high", finding: "No days (no videos)." });
      const noVideo = days.filter((d) => !d.videoId && !d.isLive);
      if (noVideo.length) findings.push({ severity: "medium", finding: `Days without a video: ${noVideo.map((d) => d.position).join(", ")}.` });
      if (funnel.endAt && funnel.endAt < now && funnel.status !== "closed") findings.push({ severity: "low", finding: `Its end date passed (${iso(funnel.endAt)}) but status is "${funnel.status}".` });
      if (!funnel.privacyUrl) findings.push({ severity: "medium", finding: "No privacy-policy link." });
      if (funnel.optinMode !== "none" && optins === 0) findings.push({ severity: "info", finding: "Opt-in is on but nobody has opted in yet." });
      for (const [label, value] of [["close button", funnel.closeButtonUrl], ["close redirect", funnel.closeRedirectUrl], ["livestream", funnel.livestreamUrl]] as const) {
        if (value && !/^https:\/\//i.test(value)) findings.push({ severity: "low", finding: `The ${label} link is not https: ${value}` });
      }
      return {
        data: {
          funnel: { id: funnel.id, name: funnel.name, slug: funnel.slug, status: funnel.status, mode: funnel.mode, timing: funnel.timing, start_at: iso(funnel.startAt), end_at: iso(funnel.endAt), progression: funnel.progression, optin_mode: funnel.optinMode, site_type: funnel.siteType },
          public_url: buildSiteUrl({ rootDomain: rootDomain(), requestHost: `app.${rootDomain()}`, site: { kind: "org", slug: org.slug }, pathname: `/l/${funnel.slug}` }),
          days: days.map((d) => ({ day: d.position, title: d.title, video: d.videoId ? `${d.videoProvider ?? "video"}:${d.videoId}` : null, unlock_at: iso(d.unlockAt), unlock_after_hours: d.unlockOffsetHours, live: d.isLive, live_start: iso(d.liveStartAt) })),
          opt_ins: optins,
          events_last_7_days: events,
          look: { header: funnel.headerBg, accent: funnel.accentColor, logo: Boolean(funnel.logoAssetId || funnel.logoUrl), privacy_url: funnel.privacyUrl, terms_url: funnel.termsUrl },
          findings,
        },
        targetType: "funnel",
        targetId: funnel.id,
      };
    },
  },
  {
    name: "audit_page",
    title: "Audit a public page",
    description:
      "Loads one public PubCommand page (any organization's site, blog, form or funnel, or a connected custom domain) and checks it: status and speed, title and description, headings, images without alt text, security headers, and up to 25 of its own links.",
    inputSchema: { type: "object", properties: { url: { type: "string", description: "Full address, e.g. https://acme.pubcommand.com/w/site/post" } }, required: ["url"], additionalProperties: false },
    readOnly: true,
    available: platform,
    run: async (_ctx, args) => {
      const url = await allowedPageUrl(str(args, "url", 2000) ?? "");
      let page: Awaited<ReturnType<typeof timedFetch>>;
      try {
        page = await timedFetch(url.toString(), "GET", 15_000);
      } catch (error) {
        throw new ToolError(`The page did not load: ${error instanceof Error ? error.message : "unknown error"}`);
      }
      const { response, ms } = page;
      const html = (await response.text()).slice(0, 3_000_000);
      const findings: Finding[] = [];
      if (response.status >= 400) findings.push({ severity: "high", finding: `Returns HTTP ${response.status}.` });
      if (response.status >= 300 && response.status < 400) findings.push({ severity: "info", finding: `Redirects (${response.status}) to ${response.headers.get("location")}.` });
      if (ms > 2500) findings.push({ severity: "medium", finding: `Slow: ${ms} ms to load.` });
      const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
      const description = /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(html)?.[1] ?? /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i.exec(html)?.[1] ?? "";
      const h1 = matchAll(html, /<h1[\s>]/gi).length;
      const images = matchAll(html, /<img\b[^>]*>/gi).map((m) => m[0]);
      const noAlt = images.filter((tag) => !/\balt=["'][^"']+["']/i.test(tag)).length;
      if (!title) findings.push({ severity: "medium", finding: "No <title>." });
      else if (title.length > 65) findings.push({ severity: "low", finding: `Title is long (${title.length} characters).` });
      if (!description) findings.push({ severity: "low", finding: "No meta description." });
      if (h1 === 0) findings.push({ severity: "low", finding: "No <h1> heading." });
      if (h1 > 1) findings.push({ severity: "low", finding: `${h1} <h1> headings (one is best).` });
      if (noAlt) findings.push({ severity: "low", finding: `${noAlt} of ${images.length} images have no alt text.` });
      const headers = response.headers;
      for (const [name, label] of [["x-content-type-options", "X-Content-Type-Options"], ["strict-transport-security", "HSTS"]] as const) {
        if (!headers.get(name) && url.protocol === "https:") findings.push({ severity: "low", finding: `No ${label} header.` });
      }
      if (!headers.get("content-security-policy") && !headers.get("x-frame-options")) findings.push({ severity: "info", finding: "No Content-Security-Policy or X-Frame-Options header (the page can be framed)." });
      const links = [...new Set(matchAll(html, /<a\b[^>]*href=["']([^"'#]+)["']/gi).map((m) => m[1]!))];
      const internal = links
        .map((href) => {
          try {
            return new URL(href, url);
          } catch {
            return null;
          }
        })
        .filter((link): link is URL => Boolean(link) && link!.hostname === url.hostname && (link!.protocol === "https:" || link!.protocol === "http:"));
      // Four at a time, so the check never floods the site it is auditing.
      const checked: { url: string; status: number }[] = [];
      const queue = internal.slice(0, 25);
      await Promise.all(
        Array.from({ length: 4 }, async () => {
          for (let link = queue.shift(); link; link = queue.shift()) {
            try {
              const head = await timedFetch(link.toString(), "HEAD", 10_000);
              const status = head.response.status === 405 ? (await timedFetch(link.toString(), "GET", 10_000)).response.status : head.response.status;
              checked.push({ url: link.pathname + link.search, status });
            } catch {
              checked.push({ url: link.pathname + link.search, status: 0 });
            }
          }
        }),
      );
      const broken = checked.filter((link) => link.status >= 400);
      const silent = checked.filter((link) => link.status === 0);
      if (broken.length) findings.push({ severity: "medium", finding: `Broken links: ${broken.map((b) => `${b.url} (${b.status})`).join(", ")}.` });
      if (silent.length) findings.push({ severity: "low", finding: `Links that did not answer within 10 seconds: ${silent.map((b) => b.url).join(", ")}.` });
      return {
        data: {
          url: url.toString(),
          status: response.status,
          load_ms: ms,
          size_kb: Math.round(Buffer.byteLength(html) / 1024),
          title,
          description,
          headings: { h1 },
          images: images.length,
          links: { total: links.length, same_site: internal.length, checked: checked.length },
          findings,
        },
      };
    },
  },
];

