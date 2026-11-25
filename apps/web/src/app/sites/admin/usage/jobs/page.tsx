import { platformCan, PLATFORM_PERMISSIONS } from "@pubcommand/core";
import { rawPrisma } from "@pubcommand/db";
import { Badge, Button } from "@pubcommand/ui";
import { TableScroll } from "@/components/table-scroll";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { JOBS } from "@/jobs";
import { readSession, readStaff } from "@/lib/auth";
import { nextSlot } from "@/lib/jobs/schedule";
import { runJob } from "@/server/platform-actions";

const TONE = { succeeded: "ok", failed: "danger", running: "accent" } as const;

function when(date: Date | null | undefined) {
  return date ? date.toISOString().replace("T", " ").slice(0, 16) + " UTC" : "—";
}

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const query = await searchParams;
  const auth = await readSession();
  const staff = auth.user ? await readStaff(auth.user.id) : null;
  if (!staff || !platformCan(staff.role, PLATFORM_PERMISSIONS.manageJobs)) return <Denied />;
  const runs = await rawPrisma().jobRun.findMany({ orderBy: { startedAt: "desc" }, take: 300 });
  const now = new Date();
  return (
    <div>
      <PageHeader
        title="Jobs"
        description="Scheduled background work. Each scheduled slot runs once across all servers; a failed run is retried at the next slot. Times shown in UTC."
      />
      <Flash error={query.error} notice={query.notice} />
      <TableScroll>
        <table className="w-full min-w-[44rem] border-collapse text-sm">
          <thead className="text-left text-xs uppercase text-muted">
            <tr>
              <th className="px-3 py-2">Job</th>
              <th>Schedule</th>
              <th>Last run</th>
              <th>Next run</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {JOBS.map((job) => {
              const last = runs.find((run) => run.job === job.name);
              return (
                <tr key={job.name} className="border-t border-line align-top">
                  <td className="px-3 py-2">
                    <p className="font-medium">{job.name}</p>
                    <p className="text-xs text-muted">{job.description}</p>
                  </td>
                  <td className="py-2 font-mono text-xs">
                    {job.schedule}
                    <span className="block font-sans text-muted">{job.timeZone ?? "America/New_York"}</span>
                  </td>
                  <td className="py-2">
                    {last ? (
                      <>
                        <Badge tone={TONE[last.status as keyof typeof TONE] ?? "neutral"}>{last.status}</Badge>
                        <span className="block text-xs text-muted">{when(last.startedAt)}</span>
                        {last.error ? <span className="pc-break block text-xs text-[#912018]">{last.error}</span> : null}
                      </>
                    ) : (
                      <span className="text-muted">Never</span>
                    )}
                  </td>
                  <td className="py-2 text-xs">{when(nextSlot(job.schedule, now, job.timeZone))}</td>
                  <td className="py-2 pr-3 text-right">
                    <form action={runJob}>
                      <input type="hidden" name="job" value={job.name} />
                      <Button type="submit" variant="secondary" size="sm">
                        Run now
                      </Button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>
      <h2 className="mb-2 mt-8 text-sm font-semibold uppercase tracking-wide text-muted">Recent runs</h2>
      <TableScroll>
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <thead className="text-left text-xs uppercase text-muted">
            <tr>
              <th className="px-3 py-2">Started</th>
              <th>Job</th>
              <th>Status</th>
              <th>Took</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {runs.slice(0, 100).map((run) => (
              <tr key={run.id} className="border-t border-line align-top">
                <td className="px-3 py-2 text-xs">{when(run.startedAt)}</td>
                <td className="pc-break">{run.job}</td>
                <td>
                  <Badge tone={TONE[run.status as keyof typeof TONE] ?? "neutral"}>{run.status}</Badge>
                  {run.trigger === "manual" ? <span className="ml-1 text-xs text-muted">manual</span> : null}
                </td>
                <td className="text-xs">{run.durationMs != null ? `${(run.durationMs / 1000).toFixed(1)}s` : "—"}</td>
                <td className="pc-break max-w-[28rem] text-xs text-muted">{run.error ?? (run.details ? JSON.stringify(run.details).slice(0, 300) : "")}</td>
              </tr>
            ))}
            {runs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-muted">No runs yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </TableScroll>
    </div>
  );
}
