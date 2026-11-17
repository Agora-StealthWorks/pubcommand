import { Button } from "@pubcommand/ui";
import { Denied, Flash } from "@/components/ui";
import { trackAccess } from "@/features/trackrecord/context";
import { buildReportNow, sendReportNow, updateReportSettings } from "@/features/trackrecord/report-actions";
import { recentReports, reportSettings, teamMembers } from "@/features/trackrecord/reports";
import { emailConfigured } from "@/lib/email";

const STATUS: Record<string, string> = { DRAFT: "Draft", SENT: "Sent", LOGGED: "Not sent (email not set up)", FAILED: "Failed" };

export default async function ReportsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string; report?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await trackAccess("performance.read", slug);
  if (!access.ok) return <Denied title={access.error} />;
  const { scope } = access;
  const [settings, members, reports] = await Promise.all([reportSettings(scope), teamMembers(scope.organizationId), recentReports(scope)]);
  const chosen = new Set(settings?.recipientIds ?? []);
  const shown = reports.find((r) => r.id === query.report) ?? reports[0] ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Weekly report</h2>
        <p className="text-sm text-muted">
          Every Friday at 4:30 pm Eastern, a performance email for {scope.brandName}: each portfolio&apos;s opens and closes this week and since inception. It
          goes only to the team members you pick, one email each. No loser count, worst trade or notes are included.
        </p>
      </div>
      <Flash error={query.error} notice={query.notice} />
      {!emailConfigured() ? (
        <p className="rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
          Email is not set up yet (<code>RESEND_API_KEY</code>). Reports are still built and saved here, but nothing is sent.
        </p>
      ) : null}

      {scope.canWrite ? (
        <form action={updateReportSettings} className="space-y-3 rounded-xl border border-line bg-white p-4">
          <h3 className="text-sm font-semibold">Settings</h3>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input type="checkbox" name="enabled" defaultChecked={settings?.enabled ?? false} className="h-4 w-4" />
            Build the report every Friday
          </label>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input type="checkbox" name="autoSend" defaultChecked={settings?.autoSend ?? true} className="h-4 w-4" />
            Send it automatically (otherwise it waits here as a draft for someone to press Send)
          </label>
          <fieldset>
            <legend className="text-sm font-medium">Send to</legend>
            <div className="mt-2 grid gap-1 sm:grid-cols-2">
              {members.map((m) => (
                <label key={m.userId} className="flex min-h-10 min-w-0 items-center gap-2 rounded-md border border-line px-3 text-sm">
                  <input type="checkbox" name="recipientIds" value={m.userId} defaultChecked={chosen.has(m.userId)} className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 truncate">
                    {m.name}
                    {m.name !== m.email ? <span className="text-muted"> · {m.email}</span> : null}
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted">Only active members of this organization can receive it.</p>
          </fieldset>
          <Button type="submit">Save settings</Button>
        </form>
      ) : null}

      <section className="space-y-3 rounded-xl border border-line bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Reports</h3>
          {scope.canWrite ? (
            <form action={buildReportNow}>
              <Button type="submit" variant="secondary" size="sm">
                Build this week&apos;s report now
              </Button>
            </form>
          ) : null}
        </div>
        {reports.length === 0 ? <p className="text-sm text-muted">No reports yet.</p> : null}
        <ul className="divide-y divide-line">
          {reports.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <a href={`/performance/reports?report=${r.id}`} className={`min-w-0 font-semibold ${shown?.id === r.id ? "text-ink" : "text-accent"}`}>
                {r.week}
              </a>
              <span className="text-xs text-muted">
                {STATUS[r.status] ?? r.status}
                {r.sentAt ? ` · ${r.sentAt.toISOString().slice(0, 10)} to ${r.sentCount}` : ""}
              </span>
            </li>
          ))}
        </ul>
        {shown ? (
          <div className="space-y-2">
            <p className="break-words text-sm font-semibold">{shown.subject}</p>
            {shown.error ? <p className="text-xs text-[#b42318]">{shown.error}</p> : null}
            <iframe title="Report preview" srcDoc={shown.html} sandbox="" className="h-[32rem] w-full rounded-lg border border-line bg-canvas" />
            {scope.canWrite && shown.status !== "SENT" ? (
              <form action={sendReportNow}>
                <input type="hidden" name="reportId" value={shown.id} />
                <Button type="submit">Send to {chosen.size} team member{chosen.size === 1 ? "" : "s"}</Button>
              </form>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
