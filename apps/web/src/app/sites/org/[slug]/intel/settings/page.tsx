import { Button, Label, Textarea, Input } from "@pubcommand/ui";
import { Denied, Flash } from "@/components/ui";
import { intelAccess } from "@/features/intel/context";
import { authSecret } from "@/features/intel/gmail";
import { removeSlackWebhook, saveDigestSettings, sendDigestNow } from "@/features/intel/more-actions";
import { readSettings } from "@/features/intel/settings";
import { formatDate, formatDay } from "@/features/intel/ui";
import { emailConfigured } from "@/lib/email";
import { decryptToken, maskWebhook } from "../../../../../../../../../modules/intel/index";

export default async function IntelSettingsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { slug } = await params;
  const search = await searchParams;
  const access = await intelAccess("read", slug);
  if (!access.ok) return <Denied title={access.error} />;
  const { scope } = access;
  const settings = await readSettings(scope.organizationId, scope.brand.id);
  let webhook: string | null = null;
  if (settings.slackWebhookEnc) {
    try {
      webhook = maskWebhook(decryptToken(settings.slackWebhookEnc, authSecret()));
    } catch {
      webhook = "saved, but it can no longer be read (AUTH_SECRET changed); save it again";
    }
  }
  const disabled = !scope.canWrite;

  return (
    <div className="min-w-0">
      <Flash error={search.error} notice={search.notice} />
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
        <form action={saveDigestSettings} className="min-w-0 space-y-4 rounded-xl border border-line bg-white p-4">
          <div>
            <h2 className="text-base font-semibold">Weekly Promo Radar digest</h2>
            <p className="mt-1 text-sm text-muted">
              Every Monday at 8:05 ET, last week&apos;s radar for {scope.brand.name} (new promos first, stated prices, recurring angles, the AI read and the week&apos;s videos) goes to Slack and/or the
              team by email.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" name="digestEnabled" defaultChecked={settings.digestEnabled} disabled={disabled} className="h-4 w-4" />
            Send the weekly digest
          </label>
          <div>
            <Label htmlFor="slack-webhook">Slack incoming webhook</Label>
            <Input id="slack-webhook" name="slackWebhook" type="url" placeholder={webhook ? "Leave blank to keep the saved webhook" : "https://hooks.slack.com/services/…"} disabled={disabled} className="mt-1" autoComplete="off" />
            <p className="mt-1 text-xs text-muted">
              {webhook ? <>Saved: {webhook}. </> : null}In Slack: Apps → Incoming Webhooks → Add to a channel, then paste the URL. It is stored encrypted and never shown again.
            </p>
          </div>
          <div>
            <Label htmlFor="digest-emails">Email it to</Label>
            <Textarea id="digest-emails" name="digestEmails" rows={3} defaultValue={settings.digestEmails.join("\n")} placeholder="Team members who asked for it, one per line" disabled={disabled} className="mt-1" />
            <p className="mt-1 text-xs text-muted">{emailConfigured() ? "Up to 20 addresses. Only add people who asked for it." : "Email is not set up yet (RESEND_API_KEY), so only Slack would be sent."}</p>
          </div>
          <hr className="border-line" />
          <div>
            <h2 className="text-base font-semibold">Landing pages</h2>
            <label className="mt-2 flex items-start gap-2 text-sm">
              <input type="checkbox" name="autoLanding" defaultChecked={settings.autoLanding} disabled={disabled} className="mt-0.5 h-4 w-4" />
              <span>
                Fetch each email&apos;s landing page (text only) before the AI extraction, so offers and prices on the page are read too. Opening a tracked link can count as a click for the
                sender.
              </span>
            </label>
          </div>
          {scope.canWrite ? <Button type="submit">Save settings</Button> : <p className="text-sm text-muted">Changing settings needs intel.write.</p>}
        </form>

        <aside className="min-w-0 space-y-4">
          <div className="rounded-xl border border-line bg-white p-4 text-sm">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Last digest</h3>
            {settings.lastDigestAt ? (
              <p className="mt-2">
                Sent {formatDate(settings.lastDigestAt)}
                {settings.lastDigestWeek ? ` for the week of ${formatDay(settings.lastDigestWeek)}` : ""}.
              </p>
            ) : (
              <p className="mt-2 text-muted">Not sent yet.</p>
            )}
            {settings.lastDigestError ? <p className="pc-break mt-2 text-[#912018]">{settings.lastDigestError}</p> : null}
            {scope.canWrite ? (
              <form action={sendDigestNow} className="mt-3">
                <Button type="submit" variant="secondary" size="sm" disabled={!settings.slackWebhookEnc && !settings.digestEmails.length}>
                  Send last week&apos;s digest now
                </Button>
              </form>
            ) : null}
          </div>
          {scope.canWrite && settings.slackWebhookEnc ? (
            <form action={removeSlackWebhook} className="rounded-xl border border-line bg-white p-4">
              <p className="mb-2 text-sm text-muted">Stop posting to Slack and delete the saved webhook.</p>
              <Button type="submit" variant="danger" size="sm">
                Remove Slack webhook
              </Button>
            </form>
          ) : null}
          <div className="rounded-xl border border-line bg-white p-4 text-sm text-muted">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Schedules</h3>
            <ul className="mt-2 space-y-1">
              <li>Gmail sync: every 3 hours.</li>
              <li>Promo Radar: Mondays 6:10 ET, for the week before.</li>
              <li>Digest: Mondays 8:05 ET.</li>
              <li>Video queue: checked every 5 minutes.</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
