import { isAgentEmail } from "@pubcommand/core";
import { platformTx, rawPrisma } from "@pubcommand/db";
import { moduleRegistry } from "@pubcommand/modules";
import { CONSOLE_ORG_SLUG } from "@/lib/console-workspace";
import { appCatalog } from "@/lib/apps";

/**
 * Usage numbers for the console Usage dashboard and the platform agents' usage tools.
 * Days are New York days (usage_daily.day); "range" is the last N days including today.
 */

const DAY_MS = 86_400_000;
const num = (value: unknown) => (typeof value === "bigint" ? Number(value) : typeof value === "number" ? value : Number(value ?? 0) || 0);

export function clampDays(value: unknown, fallback = 30): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 365) : fallback;
}

function since(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

/** "mini-blog" (path) and "miniblog" (audit action) → one app id and its name. */
export function appIdentity(raw: string): { id: string; name: string } {
  const key = raw.toLowerCase();
  const modules = moduleRegistry.all();
  const found = modules.find((item) => item.slug === key || item.id === key || item.id.replace(/-/g, "") === key.replace(/-/g, ""));
  if (found) return { id: found.id, name: appCatalog().find((card) => card.moduleId === found.id)?.name ?? found.name };
  const special: Record<string, string> = { dashboard: "Dashboard", account: "Account", search: "Search", agents: "AI Agents", settings: "Settings", org: "Organization", brand: "Brands", members: "Members", platform: "Platform" };
  return { id: key, name: special[key] ?? key.replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase()) };
}

export type Overview = {
  days: number;
  activeUsers: number;
  dau: number;
  wau: number;
  mau: number;
  logins: number;
  loginUsers: number;
  views: number;
  activeSeconds: number;
  bytes: number;
  actions: number;
  agentActions: number;
  avgSecondsPerActiveUser: number;
  series: { day: string; users: number; activeSeconds: number; views: number; logins: number; actions: number }[];
};

export async function usageOverview(daysInput: number): Promise<Overview> {
  const days = clampDays(daysInput);
  return platformTx(async (tx) => {
    const [totals] = await tx.$queryRaw<{ users: bigint; views: bigint; seconds: bigint; bytes: bigint }[]>`
      SELECT count(DISTINCT user_id) AS users, coalesce(sum(views), 0) AS views, coalesce(sum(active_seconds), 0) AS seconds, coalesce(sum(bytes), 0) AS bytes
      FROM usage_daily WHERE day > (now() AT TIME ZONE 'America/New_York')::date - ${days}::int`;
    const [windows] = await tx.$queryRaw<{ dau: bigint; wau: bigint; mau: bigint }[]>`
      SELECT
        count(DISTINCT user_id) FILTER (WHERE day = (now() AT TIME ZONE 'America/New_York')::date) AS dau,
        count(DISTINCT user_id) FILTER (WHERE day > (now() AT TIME ZONE 'America/New_York')::date - 7) AS wau,
        count(DISTINCT user_id) AS mau
      FROM usage_daily WHERE day > (now() AT TIME ZONE 'America/New_York')::date - 30`;
    const [logins] = await tx.$queryRaw<{ logins: bigint; users: bigint }[]>`
      SELECT count(*) AS logins, count(DISTINCT user_id) AS users FROM usage_logins WHERE created_at >= ${since(days)}`;
    const [actions] = await tx.$queryRaw<{ total: bigint; agents: bigint }[]>`
      SELECT count(*) AS total, count(*) FILTER (WHERE actor_kind = 'agent') AS agents FROM usage_activities WHERE created_at >= ${since(days)}`;
    const daily = await tx.$queryRaw<{ day: Date; users: bigint; seconds: bigint; views: bigint }[]>`
      SELECT day, count(DISTINCT user_id) AS users, sum(active_seconds) AS seconds, sum(views) AS views
      FROM usage_daily WHERE day > (now() AT TIME ZONE 'America/New_York')::date - ${days}::int GROUP BY day`;
    const dailyLogins = await tx.$queryRaw<{ day: Date; n: bigint }[]>`
      SELECT (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date AS day, count(*) AS n
      FROM usage_logins WHERE created_at >= ${since(days)} GROUP BY 1`;
    const dailyActions = await tx.$queryRaw<{ day: Date; n: bigint }[]>`
      SELECT (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date AS day, count(*) AS n
      FROM usage_activities WHERE created_at >= ${since(days)} GROUP BY 1`;
    const key = (date: Date) => date.toISOString().slice(0, 10);
    const byDay = new Map(daily.map((row) => [key(row.day), row]));
    const loginsByDay = new Map(dailyLogins.map((row) => [key(row.day), num(row.n)]));
    const actionsByDay = new Map(dailyActions.map((row) => [key(row.day), num(row.n)]));
    const today = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const series: Overview["series"] = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const date = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() - i));
      const day = key(date);
      const row = byDay.get(day);
      series.push({ day, users: num(row?.users), activeSeconds: num(row?.seconds), views: num(row?.views), logins: loginsByDay.get(day) ?? 0, actions: actionsByDay.get(day) ?? 0 });
    }
    const activeUsers = num(totals?.users);
    return {
      days,
      activeUsers,
      dau: num(windows?.dau),
      wau: num(windows?.wau),
      mau: num(windows?.mau),
      logins: num(logins?.logins),
      loginUsers: num(logins?.users),
      views: num(totals?.views),
      activeSeconds: num(totals?.seconds),
      bytes: num(totals?.bytes),
      actions: num(actions?.total),
      agentActions: num(actions?.agents),
      avgSecondsPerActiveUser: activeUsers ? Math.round(num(totals?.seconds) / activeUsers) : 0,
      series,
    };
  });
}

export type AppRow = {
  id: string;
  name: string;
  where: "workspace" | "console" | "picker";
  users: number;
  views: number;
  activeSeconds: number;
  bytes: number;
  actions: number;
  aiTokens: number;
  topAreas: { area: string; views: number; activeSeconds: number }[];
};

/** Apps ranked by time spent: org workspace apps, console pages and the organization picker. */
export async function appUsage(daysInput: number, options: { orgId?: string | null } = {}): Promise<AppRow[]> {
  const days = clampDays(daysInput);
  // A plain parameter, not a composed Prisma.sql fragment: in the production bundle a fragment can arrive as a value.
  const org = options.orgId ?? null;
  return platformTx(async (tx) => {
    const pages = await tx.$queryRaw<{ where: string; app: string; area: string; users: bigint; views: bigint; seconds: bigint; bytes: bigint }[]>`
      SELECT CASE WHEN site = 'admin' THEN 'console' WHEN site = 'app' THEN 'picker' ELSE 'workspace' END AS "where",
             app, area, count(DISTINCT user_id) AS users, sum(views) AS views, sum(active_seconds) AS seconds, sum(bytes) AS bytes
      FROM usage_daily WHERE day > (now() AT TIME ZONE 'America/New_York')::date - ${days}::int AND (${org}::uuid IS NULL OR organization_id = ${org}::uuid)
      GROUP BY 1, 2, 3`;
    const appUsers = await tx.$queryRaw<{ where: string; app: string; users: bigint }[]>`
      SELECT CASE WHEN site = 'admin' THEN 'console' WHEN site = 'app' THEN 'picker' ELSE 'workspace' END AS "where", app, count(DISTINCT user_id) AS users
      FROM usage_daily WHERE day > (now() AT TIME ZONE 'America/New_York')::date - ${days}::int AND (${org}::uuid IS NULL OR organization_id = ${org}::uuid)
      GROUP BY 1, 2`;
    const actions = await tx.$queryRaw<{ app: string; n: bigint }[]>`
      SELECT app, count(*) AS n FROM usage_activities WHERE created_at >= ${since(days)} AND (${org}::uuid IS NULL OR organization_id = ${org}::uuid) GROUP BY app`;
    const tokens = await tx.aiUsageLog.groupBy({
      by: ["moduleId"],
      where: { createdAt: { gte: since(days) }, ...(options.orgId ? { organizationId: options.orgId } : {}) },
      _sum: { inputTokens: true, outputTokens: true },
    });
    const rows = new Map<string, AppRow>();
    const row = (where: AppRow["where"], raw: string) => {
      const identity = where === "workspace" ? appIdentity(raw) : { id: raw, name: where === "console" ? `Console · ${appIdentity(raw).name}` : "Organization picker" };
      const key = `${where}:${identity.id}`;
      let found = rows.get(key);
      if (!found) {
        found = { ...identity, where, users: 0, views: 0, activeSeconds: 0, bytes: 0, actions: 0, aiTokens: 0, topAreas: [] };
        rows.set(key, found);
      }
      return found;
    };
    for (const page of pages) {
      const target = row(page.where as AppRow["where"], page.app);
      target.views += num(page.views);
      target.activeSeconds += num(page.seconds);
      target.bytes += num(page.bytes);
      target.topAreas.push({ area: page.area, views: num(page.views), activeSeconds: num(page.seconds) });
    }
    for (const users of appUsers) row(users.where as AppRow["where"], users.app).users += num(users.users);
    for (const action of actions) row("workspace", action.app).actions += num(action.n);
    for (const token of tokens) row("workspace", token.moduleId).aiTokens += (token._sum.inputTokens ?? 0) + (token._sum.outputTokens ?? 0);
    for (const item of rows.values()) item.topAreas = item.topAreas.sort((a, b) => b.activeSeconds - a.activeSeconds || b.views - a.views).slice(0, 5);
    return [...rows.values()].sort((a, b) => b.activeSeconds - a.activeSeconds || b.views - a.views || b.actions - a.actions);
  });
}

export type UserRow = {
  userId: string;
  email: string;
  name: string | null;
  organizations: string[];
  logins: number;
  activeDays: number;
  activeSeconds: number;
  views: number;
  actions: number;
  lastSeenAt: string | null;
  topApps: string[];
};

/** People ranked by active time (then actions). AI agents are not people: their work is counted as actions only. */
export async function topUsers(daysInput: number, options: { limit?: number; orgId?: string | null } = {}): Promise<UserRow[]> {
  const days = clampDays(daysInput);
  const take = Math.min(Math.max(options.limit ?? 25, 1), 200);
  // A plain parameter, not a composed Prisma.sql fragment: in the production bundle a fragment can arrive as a value.
  const org = options.orgId ?? null;
  const data = await platformTx(async (tx) => {
    const usage = await tx.$queryRaw<{ user_id: string; days: bigint; seconds: bigint; views: bigint; last: Date }[]>`
      SELECT user_id, count(DISTINCT day) AS days, sum(active_seconds) AS seconds, sum(views) AS views, max(last_seen_at) AS last
      FROM usage_daily WHERE day > (now() AT TIME ZONE 'America/New_York')::date - ${days}::int AND (${org}::uuid IS NULL OR organization_id = ${org}::uuid) GROUP BY user_id`;
    const logins = await tx.$queryRaw<{ user_id: string; n: bigint; last: Date }[]>`
      SELECT user_id, count(*) AS n, max(created_at) AS last FROM usage_logins WHERE created_at >= ${since(days)} AND (${org}::uuid IS NULL OR organization_id = ${org}::uuid) GROUP BY user_id`;
    const actions = await tx.$queryRaw<{ actor_id: string; n: bigint }[]>`
      SELECT actor_id, count(*) AS n FROM usage_activities WHERE created_at >= ${since(days)} AND actor_id IS NOT NULL AND (${org}::uuid IS NULL OR organization_id = ${org}::uuid) GROUP BY actor_id`;
    const apps = await tx.$queryRaw<{ user_id: string; app: string; seconds: bigint }[]>`
      SELECT user_id, app, sum(active_seconds) AS seconds FROM usage_daily
      WHERE day > (now() AT TIME ZONE 'America/New_York')::date - ${days}::int AND site NOT IN ('admin', 'app') AND (${org}::uuid IS NULL OR organization_id = ${org}::uuid) GROUP BY user_id, app`;
    return { usage, logins, actions, apps };
  });
  const ids = new Set<string>([...data.usage.map((row) => row.user_id), ...data.logins.map((row) => row.user_id), ...data.actions.map((row) => row.actor_id)]);
  const users = await rawPrisma().user.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, email: true, name: true, memberships: { where: { status: "ACTIVE" }, select: { organization: { select: { name: true, slug: true } } } } },
  });
  const usage = new Map(data.usage.map((row) => [row.user_id, row]));
  const logins = new Map(data.logins.map((row) => [row.user_id, row]));
  const actions = new Map(data.actions.map((row) => [row.actor_id, num(row.n)]));
  const apps = new Map<string, { app: string; seconds: number }[]>();
  for (const row of data.apps) apps.set(row.user_id, [...(apps.get(row.user_id) ?? []), { app: row.app, seconds: num(row.seconds) }]);
  return users
    .filter((user) => !isAgentEmail(user.email))
    .map((user) => {
      const u = usage.get(user.id);
      const l = logins.get(user.id);
      const last = [u?.last, l?.last].filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0];
      return {
        userId: user.id,
        email: user.email,
        name: user.name,
        organizations: user.memberships.map((m) => m.organization.name).filter((name) => name),
        logins: num(l?.n),
        activeDays: num(u?.days),
        activeSeconds: num(u?.seconds),
        views: num(u?.views),
        actions: actions.get(user.id) ?? 0,
        lastSeenAt: last?.toISOString() ?? null,
        topApps: (apps.get(user.id) ?? [])
          .sort((a, b) => b.seconds - a.seconds)
          .slice(0, 3)
          .map((item) => appIdentity(item.app).name),
      };
    })
    .sort((a, b) => b.activeSeconds - a.activeSeconds || b.actions - a.actions || b.logins - a.logins)
    .slice(0, take);
}

export type OrgRow = { orgId: string; name: string; slug: string; activeUsers: number; activeSeconds: number; views: number; actions: number; logins: number };

export async function orgUsage(daysInput: number): Promise<OrgRow[]> {
  const days = clampDays(daysInput);
  const data = await platformTx(async (tx) => {
    const usage = await tx.$queryRaw<{ org: string; users: bigint; seconds: bigint; views: bigint }[]>`
      SELECT organization_id AS org, count(DISTINCT user_id) AS users, sum(active_seconds) AS seconds, sum(views) AS views
      FROM usage_daily WHERE organization_id IS NOT NULL AND day > (now() AT TIME ZONE 'America/New_York')::date - ${days}::int GROUP BY 1`;
    const actions = await tx.$queryRaw<{ org: string; n: bigint }[]>`
      SELECT organization_id AS org, count(*) AS n FROM usage_activities WHERE created_at >= ${since(days)} GROUP BY 1`;
    const logins = await tx.$queryRaw<{ org: string; n: bigint }[]>`
      SELECT organization_id AS org, count(*) AS n FROM usage_logins WHERE organization_id IS NOT NULL AND created_at >= ${since(days)} GROUP BY 1`;
    return { usage, actions, logins };
  });
  const ids = new Set([...data.usage.map((r) => r.org), ...data.actions.map((r) => r.org), ...data.logins.map((r) => r.org)]);
  const orgs = await rawPrisma().organization.findMany({ where: { id: { in: [...ids] }, NOT: { slug: CONSOLE_ORG_SLUG } }, select: { id: true, name: true, slug: true } });
  const usage = new Map(data.usage.map((r) => [r.org, r]));
  const actions = new Map(data.actions.map((r) => [r.org, num(r.n)]));
  const logins = new Map(data.logins.map((r) => [r.org, num(r.n)]));
  return orgs
    .map((org) => ({
      orgId: org.id,
      name: org.name,
      slug: org.slug,
      activeUsers: num(usage.get(org.id)?.users),
      activeSeconds: num(usage.get(org.id)?.seconds),
      views: num(usage.get(org.id)?.views),
      actions: actions.get(org.id) ?? 0,
      logins: logins.get(org.id) ?? 0,
    }))
    .sort((a, b) => b.activeSeconds - a.activeSeconds || b.actions - a.actions);
}

export type ActivityRow = {
  id: string;
  at: string;
  organization: string;
  who: string;
  actorKind: string;
  app: string;
  action: string;
  summary: string;
  title: string | null;
  content: string | null;
};

export async function recentActivities(filter: { days?: number; orgId?: string | null; app?: string | null; actorId?: string | null; verb?: string | null; query?: string | null; take?: number; withContent?: boolean } = {}): Promise<ActivityRow[]> {
  const days = clampDays(filter.days ?? 7, 7);
  const app = filter.app ? appIdentity(filter.app) : null;
  const rows = await platformTx((tx) =>
    tx.usageActivity.findMany({
      where: {
        createdAt: { gte: since(days) },
        ...(filter.orgId ? { orgId: filter.orgId } : {}),
        ...(app ? { app: { in: [...new Set([app.id, app.id.replace(/-/g, ""), filter.app!.toLowerCase()])] } } : {}),
        ...(filter.actorId ? { actorId: filter.actorId } : {}),
        ...(filter.verb ? { verb: filter.verb } : {}),
        ...(filter.query ? { OR: [{ title: { contains: filter.query, mode: "insensitive" } }, { content: { contains: filter.query, mode: "insensitive" } }, { summary: { contains: filter.query, mode: "insensitive" } }] } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(filter.take ?? 50, 1), 500),
    }),
  );
  const [users, orgs] = await Promise.all([
    rawPrisma().user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actorId).filter((id): id is string => Boolean(id)))] } }, select: { id: true, email: true, name: true } }),
    rawPrisma().organization.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.orgId))] } }, select: { id: true, name: true } }),
  ]);
  const who = new Map(users.map((u) => [u.id, isAgentEmail(u.email) ? `${u.name ?? "AI agent"} (AI agent)` : u.name ? `${u.name} <${u.email}>` : u.email]));
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  return rows.map((row) => ({
    id: row.id,
    at: row.createdAt.toISOString(),
    organization: orgName.get(row.orgId) ?? row.orgId,
    who: row.actorId ? (who.get(row.actorId) ?? row.actorId) : "System",
    actorKind: row.actorKind,
    app: appIdentity(row.app).name,
    action: row.action,
    summary: row.summary,
    title: row.title,
    content: filter.withContent === false ? null : row.content,
  }));
}

export type UserUsage = {
  idleTimeoutMinutes: number | null;
  loginsAllTime: number;
  loginsInRange: number;
  firstLoginAt: string | null;
  lastLoginAt: string | null;
  lastActiveAt: string | null;
  activeDays: number;
  activeSeconds: number;
  views: number;
  actions: number;
  apps: { name: string; activeSeconds: number; views: number }[];
  recentLogins: { at: string; method: string; site: string; userAgent: string | null }[];
};

export async function userUsage(userId: string, daysInput: number): Promise<UserUsage> {
  const days = clampDays(daysInput);
  const [user, session] = await Promise.all([
    rawPrisma().user.findUnique({ where: { id: userId }, select: { idleTimeoutMinutes: true } }),
    rawPrisma().session.findFirst({ where: { userId }, orderBy: { lastActiveAt: "desc" }, select: { lastActiveAt: true } }),
  ]);
  return platformTx(async (tx) => {
    const [allTime, inRange, first, recent, usage, apps, actions] = await Promise.all([
      tx.usageLogin.count({ where: { userId } }),
      tx.usageLogin.count({ where: { userId, createdAt: { gte: since(days) } } }),
      tx.usageLogin.findFirst({ where: { userId }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
      tx.usageLogin.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 10 }),
      tx.$queryRaw<{ days: bigint; seconds: bigint; views: bigint; last: Date | null }[]>`
        SELECT count(DISTINCT day) AS days, coalesce(sum(active_seconds), 0) AS seconds, coalesce(sum(views), 0) AS views, max(last_seen_at) AS last
        FROM usage_daily WHERE user_id = ${userId}::uuid AND day > (now() AT TIME ZONE 'America/New_York')::date - ${days}::int`,
      tx.$queryRaw<{ site: string; app: string; seconds: bigint; views: bigint }[]>`
        SELECT site, app, sum(active_seconds) AS seconds, sum(views) AS views FROM usage_daily
        WHERE user_id = ${userId}::uuid AND day > (now() AT TIME ZONE 'America/New_York')::date - ${days}::int GROUP BY 1, 2`,
      tx.usageActivity.count({ where: { actorId: userId, createdAt: { gte: since(days) } } }),
    ]);
    const row = usage[0];
    const lastActive = [row?.last, session?.lastActiveAt].filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0];
    return {
      idleTimeoutMinutes: user?.idleTimeoutMinutes ?? null,
      loginsAllTime: allTime,
      loginsInRange: inRange,
      firstLoginAt: first?.createdAt.toISOString() ?? null,
      lastLoginAt: recent[0]?.createdAt.toISOString() ?? null,
      lastActiveAt: lastActive?.toISOString() ?? null,
      activeDays: num(row?.days),
      activeSeconds: num(row?.seconds),
      views: num(row?.views),
      actions,
      apps: apps
        .map((item) => ({ name: item.site === "admin" ? `Console · ${appIdentity(item.app).name}` : item.site === "app" ? "Organization picker" : appIdentity(item.app).name, activeSeconds: num(item.seconds), views: num(item.views) }))
        .sort((a, b) => b.activeSeconds - a.activeSeconds)
        .slice(0, 10),
      recentLogins: recent.map((login) => ({ at: login.createdAt.toISOString(), method: login.method, site: login.site, userAgent: login.userAgent })),
    };
  });
}

export type ServerHealth = {
  instances: { service: string; instance: string; at: string; rssBytes: number; heapUsedBytes: number; cpuPercent: number | null; uptimeSeconds: number }[];
  avgRssBytes: number;
  maxRssBytes: number;
  avgCpuPercent: number | null;
  series: { hour: string; maxRssBytes: number; avgHeapUsedBytes: number }[];
  databaseBytes: number;
  tables: { table: string; bytes: number; rows: number }[];
};

export async function serverHealth(daysInput: number): Promise<ServerHealth> {
  const days = Math.min(clampDays(daysInput, 7), 30);
  return platformTx(async (tx) => {
    const latest = await tx.$queryRaw<{ service: string; instance: string; created_at: Date; rss_bytes: bigint; heap_used_bytes: bigint; cpu_percent: number | null; uptime_seconds: number }[]>`
      SELECT DISTINCT ON (service, instance) service, instance, created_at, rss_bytes, heap_used_bytes, cpu_percent, uptime_seconds
      FROM usage_server_samples WHERE created_at >= now() - interval '1 day' ORDER BY service, instance, created_at DESC`;
    const [agg] = await tx.$queryRaw<{ avg: number | null; max: bigint | null; cpu: number | null }[]>`
      SELECT avg(rss_bytes)::float AS avg, max(rss_bytes) AS max, avg(cpu_percent)::float AS cpu FROM usage_server_samples WHERE created_at >= ${since(days)}`;
    const series = await tx.$queryRaw<{ hour: Date; max: bigint; heap: number }[]>`
      SELECT date_trunc('hour', created_at) AS hour, max(rss_bytes) AS max, avg(heap_used_bytes)::float AS heap
      FROM usage_server_samples WHERE created_at >= ${since(days)} GROUP BY 1 ORDER BY 1`;
    const [size] = await tx.$queryRaw<{ bytes: bigint }[]>`SELECT pg_database_size(current_database()) AS bytes`;
    const tables = await tx.$queryRaw<{ table: string; bytes: bigint; rows: bigint }[]>`
      SELECT c.relname AS "table", pg_total_relation_size(c.oid) AS bytes, greatest(c.reltuples, 0)::bigint AS rows
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 2 DESC LIMIT 12`;
    return {
      instances: latest.map((row) => ({ service: row.service, instance: row.instance, at: row.created_at.toISOString(), rssBytes: num(row.rss_bytes), heapUsedBytes: num(row.heap_used_bytes), cpuPercent: row.cpu_percent, uptimeSeconds: row.uptime_seconds })),
      avgRssBytes: Math.round(num(agg?.avg)),
      maxRssBytes: num(agg?.max),
      avgCpuPercent: agg?.cpu == null ? null : Math.round(agg.cpu * 10) / 10,
      series: series.map((row) => ({ hour: row.hour.toISOString(), maxRssBytes: num(row.max), avgHeapUsedBytes: Math.round(num(row.heap)) })),
      databaseBytes: num(size?.bytes),
      tables: tables.map((row) => ({ table: row.table, bytes: num(row.bytes), rows: num(row.rows) })),
    };
  });
}
