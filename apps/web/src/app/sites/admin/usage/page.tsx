import { formatBytes, formatDuration, platformCan, PLATFORM_PERMISSIONS } from "@pubcommand/core";
import Link from "next/link";
import { TableScroll } from "@/components/table-scroll";
import { Denied, PageHeader } from "@/components/ui";
import { listOpsNotes } from "@/features/usage/ops-brain";
import { DailyBars, RangePicker, SectionTitle, ShareBar, StatTile, when } from "@/features/usage/parts";
import { appUsage, clampDays, orgUsage, recentActivities, serverHealth, topUsers, usageOverview } from "@/features/usage/stats";
import { readSession, readStaff } from "@/lib/auth";

const WHERE_LABEL = { workspace: "Workspace", console: "Console", picker: "Picker" } as const;

export default async function UsageDashboard({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const query = await searchParams;
  const auth = await readSession();
  const staff = auth.user ? await readStaff(auth.user.id) : null;
  if (!staff || !platformCan(staff.role, PLATFORM_PERMISSIONS.viewAudit)) return <Denied />;
  const days = clampDays(query.days, 30);
  const [overview, apps, users, orgs, activity, health, notes] = await Promise.all([
    usageOverview(days),
    appUsage(days),
    topUsers(days, { limit: 25 }),
    orgUsage(days),
    recentActivities({ days, take: 12, withContent: false }),
    serverHealth(Math.min(days, 30)),
    platformCan(staff.role, PLATFORM_PERMISSIONS.manageBrain) ? listOpsNotes({ take: 3 }) : Promise.resolve([]),
  ]);
  const workspaceApps = apps.filter((app) => app.where === "workspace");
  const maxAppSeconds = Math.max(0, ...workspaceApps.map((app) => app.activeSeconds));
  const maxUserSeconds = Math.max(0, ...users.map((user) => user.activeSeconds));
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Usage"
          description="How people use PubCommand across every organization: sign-ins, time in each app, what they made, and the servers. Time counts only while a tab is visible and in use."
        />
        <RangePicker days={days} base="/usage" />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Active people" value={String(overview.activeUsers)} hint={`Today ${overview.dau} · 7d ${overview.wau} · 30d ${overview.mau}`} />
        <StatTile label="Sign-ins" value={String(overview.logins)} hint={`${overview.loginUsers} people`} />
        <StatTile label="Time in the app" value={formatDuration(overview.activeSeconds)} hint={`${formatDuration(overview.avgSecondsPerActiveUser)} per active person`} />
        <StatTile label="Things made or changed" value={String(overview.actions)} hint={overview.agentActions ? `${overview.agentActions} by AI agents` : "Forms, posts, promos, funnels…"} />
        <StatTile label="Page views" value={String(overview.views)} />
        <StatTile label="Bandwidth" value={formatBytes(overview.bytes)} hint="Downloaded by people's browsers" />
        <StatTile label="Server memory" value={formatBytes(health.avgRssBytes)} hint={`Average · peak ${formatBytes(health.maxRssBytes)}`} />
        <StatTile label="Database" value={formatBytes(health.databaseBytes)} hint={health.avgCpuPercent != null ? `Web CPU avg ${health.avgCpuPercent}%` : undefined} />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <DailyBars title="Active people" points={overview.series.map((point) => ({ day: point.day, value: point.users }))} format={(value) => `${value} people`} />
        <DailyBars title="Time in the app" points={overview.series.map((point) => ({ day: point.day, value: point.activeSeconds }))} format={formatDuration} />
        <DailyBars title="Things made or changed" points={overview.series.map((point) => ({ day: point.day, value: point.actions }))} format={(value) => `${value}`} />
      </div>

      {notes.length ? (
        <>
          <SectionTitle action={<Link href="/brain/ops" className="text-sm text-accent hover:underline">All notes</Link>}>Operations Brain</SectionTitle>
          <ul className="grid gap-2 md:grid-cols-3">
            {notes.map((note) => (
              <li key={note.id}>
                <Link href={`/brain/ops/${note.id}`} className="block h-full rounded-lg border border-line bg-white px-4 py-3 hover:bg-canvas">
                  <p className="text-xs uppercase tracking-wide text-muted">{note.kind === "weekly" ? "Weekly strategy" : note.kind === "daily" ? "Daily read" : "Note"}</p>
                  <p className="mt-1 text-sm font-medium">{note.title}</p>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <SectionTitle>Most popular apps</SectionTitle>
      <TableScroll>
        <table className="w-full min-w-[48rem] border-collapse text-sm">
          <thead className="text-left text-xs uppercase text-muted">
            <tr>
              <th className="px-3 py-2">App</th>
              <th>Time</th>
              <th />
              <th>People</th>
              <th>Views</th>
              <th>Made / changed</th>
              <th>AI tokens</th>
              <th>Bandwidth</th>
              <th>Busiest pages</th>
            </tr>
          </thead>
          <tbody>
            {workspaceApps.map((app) => (
              <tr key={app.id} className="border-t border-line align-top">
                <td className="px-3 py-2 font-medium">{app.name}</td>
                <td className="py-2 tabular-nums">{formatDuration(app.activeSeconds)}</td>
                <td className="py-3 pr-2"><ShareBar value={app.activeSeconds} max={maxAppSeconds} /></td>
                <td className="py-2 tabular-nums">{app.users}</td>
                <td className="py-2 tabular-nums">{app.views}</td>
                <td className="py-2 tabular-nums">{app.actions}</td>
                <td className="py-2 tabular-nums">{app.aiTokens ? app.aiTokens.toLocaleString() : "—"}</td>
                <td className="py-2 tabular-nums">{formatBytes(app.bytes)}</td>
                <td className="pc-break py-2 text-xs text-muted">{app.topAreas.slice(0, 3).map((area) => `${area.area} (${formatDuration(area.activeSeconds)})`).join(" · ") || "—"}</td>
              </tr>
            ))}
            {workspaceApps.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-4 text-muted">No app use recorded in this range yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </TableScroll>

      <SectionTitle>Most active people</SectionTitle>
      <TableScroll>
        <table className="w-full min-w-[48rem] border-collapse text-sm">
          <thead className="text-left text-xs uppercase text-muted">
            <tr>
              <th className="px-3 py-2">Person</th>
              <th>Organizations</th>
              <th>Time</th>
              <th />
              <th>Sign-ins</th>
              <th>Days active</th>
              <th>Made / changed</th>
              <th>Top apps</th>
              <th>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.userId} className="border-t border-line align-top">
                <td className="pc-break px-3 py-2">
                  <Link href={`/users/${user.userId}`} className="font-medium text-accent hover:underline">{user.name || user.email}</Link>
                  {user.name ? <span className="block text-xs text-muted">{user.email}</span> : null}
                </td>
                <td className="pc-break py-2 text-xs">{user.organizations.join(", ") || "—"}</td>
                <td className="py-2 tabular-nums">{formatDuration(user.activeSeconds)}</td>
                <td className="py-3 pr-2"><ShareBar value={user.activeSeconds} max={maxUserSeconds} /></td>
                <td className="py-2 tabular-nums">{user.logins}</td>
                <td className="py-2 tabular-nums">{user.activeDays}</td>
                <td className="py-2 tabular-nums">{user.actions}</td>
                <td className="py-2 text-xs">{user.topApps.join(", ") || "—"}</td>
                <td className="py-2 text-xs">{when(user.lastSeenAt)}</td>
              </tr>
            ))}
            {users.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-4 text-muted">Nobody yet in this range.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </TableScroll>

      <SectionTitle>Organizations</SectionTitle>
      <TableScroll>
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <thead className="text-left text-xs uppercase text-muted">
            <tr>
              <th className="px-3 py-2">Organization</th>
              <th>Active people</th>
              <th>Time</th>
              <th>Sign-ins</th>
              <th>Views</th>
              <th>Made / changed</th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((org) => (
              <tr key={org.orgId} className="border-t border-line">
                <td className="px-3 py-2"><Link href={`/orgs/${org.orgId}`} className="font-medium text-accent hover:underline">{org.name}</Link></td>
                <td className="tabular-nums">{org.activeUsers}</td>
                <td className="tabular-nums">{formatDuration(org.activeSeconds)}</td>
                <td className="tabular-nums">{org.logins}</td>
                <td className="tabular-nums">{org.views}</td>
                <td className="tabular-nums">
                  <Link href={`/usage/activity?org=${org.slug}&days=${days}`} className="hover:underline">{org.actions}</Link>
                </td>
              </tr>
            ))}
            {orgs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-muted">No organization activity in this range yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </TableScroll>

      <SectionTitle action={<Link href={`/usage/activity?days=${days}`} className="text-sm text-accent hover:underline">All activity</Link>}>Latest work</SectionTitle>
      <ul className="divide-y divide-line rounded-lg border border-line bg-white">
        {activity.map((item) => (
          <li key={item.id} className="px-4 py-2 text-sm">
            <span className="text-muted">{when(item.at)} · {item.organization} · {item.app} · </span>
            <span className="font-medium">{item.who}</span> {item.summary}
          </li>
        ))}
        {activity.length === 0 ? <li className="px-4 py-3 text-sm text-muted">Nothing recorded yet. The usage.capture job adds activity every 10 minutes.</li> : null}
      </ul>

      <SectionTitle>Console and picker</SectionTitle>
      <TableScroll>
        <table className="w-full min-w-[32rem] border-collapse text-sm">
          <thead className="text-left text-xs uppercase text-muted">
            <tr>
              <th className="px-3 py-2">Page</th>
              <th>Where</th>
              <th>Time</th>
              <th>People</th>
              <th>Views</th>
            </tr>
          </thead>
          <tbody>
            {apps
              .filter((app) => app.where !== "workspace")
              .slice(0, 15)
              .map((app) => (
                <tr key={`${app.where}:${app.id}`} className="border-t border-line">
                  <td className="px-3 py-2">{app.name}</td>
                  <td>{WHERE_LABEL[app.where]}</td>
                  <td className="tabular-nums">{formatDuration(app.activeSeconds)}</td>
                  <td className="tabular-nums">{app.users}</td>
                  <td className="tabular-nums">{app.views}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </TableScroll>

      <SectionTitle>Servers and storage</SectionTitle>
      <div className="grid gap-3 lg:grid-cols-2">
        <TableScroll>
          <table className="w-full min-w-[28rem] border-collapse text-sm">
            <thead className="text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-3 py-2">Web instance</th>
                <th>Memory (RSS)</th>
                <th>Heap used</th>
                <th>CPU</th>
                <th>Up</th>
              </tr>
            </thead>
            <tbody>
              {health.instances.map((item) => (
                <tr key={`${item.service}:${item.instance}`} className="border-t border-line">
                  <td className="pc-break px-3 py-2 text-xs">{item.service} · {item.instance}<span className="block text-muted">{when(item.at)}</span></td>
                  <td className="tabular-nums">{formatBytes(item.rssBytes)}</td>
                  <td className="tabular-nums">{formatBytes(item.heapUsedBytes)}</td>
                  <td className="tabular-nums">{item.cpuPercent != null ? `${item.cpuPercent}%` : "—"}</td>
                  <td className="tabular-nums">{formatDuration(item.uptimeSeconds)}</td>
                </tr>
              ))}
              {health.instances.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-muted">No samples in the last day. Each web server records one every 5 minutes.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </TableScroll>
        <TableScroll>
          <table className="w-full min-w-[24rem] border-collapse text-sm">
            <thead className="text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-3 py-2">Largest tables</th>
                <th>Size</th>
                <th>Rows (est.)</th>
              </tr>
            </thead>
            <tbody>
              {health.tables.map((table) => (
                <tr key={table.table} className="border-t border-line">
                  <td className="px-3 py-2 font-mono text-xs">{table.table}</td>
                  <td className="tabular-nums">{formatBytes(table.bytes)}</td>
                  <td className="tabular-nums">{table.rows.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </div>
    </div>
  );
}
