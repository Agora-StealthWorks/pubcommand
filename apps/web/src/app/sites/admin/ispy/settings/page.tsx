import { Flash } from "@/components/ui";
import { registerMachineMailWebhook, saveSettings } from "@/features/ispy/console-actions";
import { Back, btn, btnPrimary, card, input, label, Pill } from "@/features/ispy/console-ui";
import { inboxDomain } from "@/features/ispy/admin";
import { gmailEnv } from "@/features/intel/gmail";
import { machineMailConfig } from "@/features/ispy/providers/machinemail";
import { readIspySettings } from "@/features/ispy/settings";
import { aiConfigured } from "@pubcommand/ai";

export const metadata = { title: "ISpy · Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const query = await searchParams;
  const settings = await readIspySettings();
  const mm = machineMailConfig();
  const domain = inboxDomain();
  return (
    <div className="flex flex-col gap-4">
      <Flash error={query.error} notice={query.notice} />
      <section className={`${card} flex flex-col gap-2 p-4 text-sm`}>
        <h2 className="text-base font-semibold">Mail providers</h2>
        <div className="flex flex-wrap items-center gap-2">MachineMail {mm ? <Pill tone="ok">key set</Pill> : <Pill tone="warn">MACHINEMAIL_API_KEY not set</Pill>}</div>
        <div className="flex flex-wrap items-center gap-2">Inbox domain {domain ? <code>{domain}</code> : <span className="text-muted">machinemail.dev (shared). Set MACHINEMAIL_DOMAIN for your own catch-all domain.</span>}</div>
        <div className="flex flex-wrap items-center gap-2">
          MachineMail webhook {mm?.webhookSecret || settings.machineMailWebhookSecretEnc ? <Pill tone="ok">signing secret stored</Pill> : <Pill tone="warn">not registered</Pill>}
          {mm ? (
            <form action={registerMachineMailWebhook}>
              <Back to="/ispy/settings" />
              <button className={btn} type="submit">Register webhook</button>
            </form>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">Legacy Gmail {gmailEnv() ? <Pill tone="ok">Google client set</Pill> : <Pill tone="warn">GOOGLE_CLIENT_ID / SECRET not set</Pill>}</div>
        <div className="flex flex-wrap items-center gap-2">Generic inbound route {process.env.ISPY_INBOUND_SECRET ? <Pill tone="ok">ISPY_INBOUND_SECRET set</Pill> : <Pill>off</Pill>}</div>
        <div className="flex flex-wrap items-center gap-2">AI (one small call per new copy) {aiConfigured() ? <Pill tone="ok">on</Pill> : <Pill tone="warn">ANTHROPIC_API_KEY not set: copies are stored without takeaways</Pill>}</div>
        <p className="text-xs text-muted">ISpy&apos;s jobs run on the server that sets JOBS_INCLUDE=ispy. (the ISpy Railway service). See Usage → Jobs for their runs.</p>
      </section>
      <section className={`${card} p-4`}>
        <h2 className="mb-3 text-base font-semibold">Digest and alerts</h2>
        <form action={saveSettings} className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Back to="/ispy/settings" />
          <label className={label}>
            Slack incoming webhook {settings.slackWebhookEnc ? "(one is saved; paste a new one to replace it)" : ""}
            <input name="slackWebhook" type="url" placeholder="https://hooks.slack.com/services/…" className={input} autoComplete="off" />
          </label>
          <label className={label}>
            Digest emails (comma or one per line)
            <textarea name="digestEmails" rows={2} defaultValue={settings.digestEmails.join("\n")} className={`${input} py-2`} />
          </label>
          <label className={label}>
            Alert when an inbox gets no mail for (days)
            <input name="silenceDays" type="number" min={1} max={90} defaultValue={settings.silenceDays} className={input} />
          </label>
          <div className="flex flex-col gap-1">
            <label className="inline-flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" name="dailyDigest" defaultChecked={settings.dailyDigest} /> Daily digest: new promos and reused copy
            </label>
            <label className="inline-flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" name="weeklyTrends" defaultChecked={settings.weeklyTrends} /> Weekly niche-wide trends (one short AI summary per feed)
            </label>
            {settings.slackWebhookEnc ? (
              <label className="inline-flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" name="clearSlack" /> Remove the saved Slack webhook
              </label>
            ) : null}
          </div>
          <div className="md:col-span-2">
            <button className={btnPrimary} type="submit">Save settings</button>
          </div>
        </form>
      </section>
    </div>
  );
}
