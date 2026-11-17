import { Badge, Button, Input } from "@pubcommand/ui";
import { Denied, Flash } from "@/components/ui";
import { connectGmail, disconnectGmail, syncGmailNow, updateGmailFilter } from "@/features/intel/actions";
import { intelAccess } from "@/features/intel/context";
import { listGmailAccounts } from "@/features/intel/data";
import { gmailEnv, gmailRedirectUri } from "@/features/intel/gmail";
import { formatDate } from "@/features/intel/ui";
import { currentRequest } from "@/lib/request";
import { GMAIL_SCOPE } from "../../../../../../../../../modules/intel/index";

export default async function IntelGmailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { slug } = await params;
  const search = await searchParams;
  const access = await intelAccess("read", slug);
  if (!access.ok) return <Denied title={access.error} />;
  const { scope } = access;
  const request = await currentRequest();
  const env = gmailEnv();
  const redirectUri = gmailRedirectUri(request.host);
  const accounts = await listGmailAccounts(scope.organizationId, scope.brand.id);
  const cronReady = Boolean(process.env.INTEL_CRON_SECRET);

  return (
    <div className="min-w-0 max-w-4xl">
      <Flash error={search.error} notice={search.notice} />
      <section className="mb-4 rounded-xl border border-line bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Gmail inboxes for {scope.brand.name}</h2>
            <p className="mt-1 text-sm text-muted">
              Connect a Gmail account that is subscribed to competitors&apos; lists. Intel reads it (read-only), files new mail into this brand&apos;s inbox and matches the senders.
              Nothing is sent, labelled or deleted in Gmail.
            </p>
          </div>
          {env && scope.canWrite ? (
            <form action={connectGmail}>
              <Button type="submit">Connect Gmail</Button>
            </form>
          ) : null}
        </div>
      </section>

      {!env ? (
        <section className="mb-4 rounded-xl border border-[#fedf89] bg-[#fffaeb] p-5 text-sm text-[#93370d]">
          <h3 className="font-semibold">Google sign-in is not set up yet</h3>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5">
            <li>In Google Cloud Console, create a project and enable the <strong>Gmail API</strong>.</li>
            <li>
              Under OAuth consent screen, add the scope <code className="pc-break">{GMAIL_SCOPE}</code>. While the app is in testing, add each inbox as a test user.
            </li>
            <li>
              Create an OAuth client of type <strong>Web application</strong> with this authorized redirect URI:
              <code className="pc-break mt-1 block rounded bg-white px-2 py-1 text-ink">{redirectUri}</code>
            </li>
            <li>
              In Railway, set <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> and redeploy. Then press Connect Gmail here.
            </li>
          </ol>
          <p className="mt-2">Until then, add emails by uploading .eml or .mbox files or pasting them.</p>
        </section>
      ) : null}

      {accounts.length === 0 ? (
        <p className="rounded-xl border border-line bg-white p-5 text-sm text-muted">No inbox connected for this brand.</p>
      ) : (
        <ul className="space-y-3">
          {accounts.map((account) => (
            <li key={account.id} className="rounded-xl border border-line bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="pc-break min-w-0 font-semibold">{account.email}</span>
                {account.syncStatus === "RUNNING" && Date.now() - account.updatedAt.getTime() < 10 * 60 * 1000 ? <Badge tone="warn">syncing</Badge> : null}
                {account.lastSyncError ? <Badge tone="danger">needs attention</Badge> : account.lastSyncAt ? <Badge tone="ok">connected</Badge> : <Badge>not synced yet</Badge>}
              </div>
              <p className="mt-1 text-sm text-muted">
                {account.lastSyncAt ? `Last sync ${formatDate(account.lastSyncAt)}, ${account.lastSyncAdded} new.` : "Not synced yet. The first sync reads the last 30 days."}
                {account.historyId ? " Later syncs read only new mail." : ""}
              </p>
              {account.lastSyncError ? <p className="mt-1 text-sm text-[#912018]">{account.lastSyncError}</p> : null}
              {scope.canWrite ? (
                <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
                  <form action={updateGmailFilter} className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
                    <input type="hidden" name="accountId" value={account.id} />
                    <div className="min-w-0 flex-1">
                      <label htmlFor={`filter-${account.id}`} className="text-xs font-semibold text-muted">
                        Gmail search filter (optional)
                      </label>
                      <Input id={`filter-${account.id}`} name="query" defaultValue={account.query ?? ""} placeholder="label:competitors" className="mt-1" />
                    </div>
                    <Button type="submit" variant="secondary" size="sm">
                      Save filter
                    </Button>
                  </form>
                  <div className="flex flex-wrap gap-2">
                    <form action={syncGmailNow}>
                      <input type="hidden" name="accountId" value={account.id} />
                      <Button type="submit" size="sm" disabled={!env}>
                        Sync now
                      </Button>
                    </form>
                    <form action={disconnectGmail}>
                      <input type="hidden" name="accountId" value={account.id} />
                      <Button type="submit" variant="danger" size="sm">
                        Disconnect
                      </Button>
                    </form>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <section className="mt-4 rounded-xl border border-line bg-white p-5 text-sm">
        <h3 className="font-semibold">Automatic sync</h3>
        {cronReady ? (
          <p className="mt-1 text-muted">
            The scheduled job can call <code className="pc-break">POST /api/intel/cron?job=sync</code> (every few hours) and <code className="pc-break">?job=radar</code> (Mondays) with the header{" "}
            <code>Authorization: Bearer $INTEL_CRON_SECRET</code>.
          </p>
        ) : (
          <p className="mt-1 text-muted">
            Set <code>INTEL_CRON_SECRET</code> in Railway, then schedule <code className="pc-break">POST /api/intel/cron?job=sync</code> every few hours and{" "}
            <code className="pc-break">?job=radar</code> on Mondays with <code>Authorization: Bearer $INTEL_CRON_SECRET</code>. Until then, use Sync now.
          </p>
        )}
      </section>
    </div>
  );
}
