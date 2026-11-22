import { addressOf, can } from "@pubcommand/core";
import { Button, Input, Label } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { connectResendKeyAction, removeResendKeyAction, saveDefaultSenderAction, sendTestEmailAction } from "@/features/email/actions";
import { getOrgEmailStatus } from "@/features/email/org-email";
import { SenderForm } from "@/features/email/sender-form";
import { emailConfigured } from "@/lib/email";
import { emailFrom } from "@/lib/mail";
import { getOrgContext } from "@/lib/org";

export default async function EmailSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") notFound();
  if (!can(ctx.subject, "settings.manage", { organizationId: ctx.resolved.id, brandId: null })) return <Denied />;
  const status = await getOrgEmailStatus(ctx.resolved.id);
  const platformAddress = addressOf(emailFrom());

  return (
    <div className="max-w-2xl min-w-0 space-y-4">
      <PageHeader
        title="Email"
        description="Emails your websites send to readers (set or reset a password) go out through your own Resend account, from your own address."
      />
      <Flash error={query.error} notice={query.notice} />

      <section className="rounded-xl border border-line bg-white p-5" aria-labelledby="resend-heading">
        <h2 id="resend-heading" className="font-semibold">Resend account</h2>
        {status.connected ? (
          <>
            <p className="mt-2 text-sm" data-testid="resend-status">
              <span className="font-semibold text-[#067647]">Connected</span> · key ending {status.keyHint}
              {status.connectedAt ? <span className="text-muted"> · since {status.connectedAt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}</span> : null}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <form action={sendTestEmailAction}>
                <Button type="submit" className="w-full sm:w-auto">Send test email</Button>
              </form>
              <form action={removeResendKeyAction}>
                <Button type="submit" variant="danger" className="w-full sm:w-auto">Remove</Button>
              </form>
            </div>
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-semibold text-accent">Replace the key</summary>
              <form action={connectResendKeyAction} className="mt-3 space-y-2">
                <Label htmlFor="resend-key-replace">New Resend API key</Label>
                <Input id="resend-key-replace" name="apiKey" type="password" autoComplete="off" required placeholder="re_…" />
                <Button type="submit" variant="secondary" className="w-full sm:w-auto">Replace key</Button>
              </form>
            </details>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted" data-testid="resend-status">
              Not connected. {emailConfigured() ? `Until you connect one, reader emails go out from PubCommand's address (${platformAddress}) with your brand's name as the sender name, and replies go to your brand's address.` : "Until you connect one, reader emails are not sent."}
            </p>
            <form action={connectResendKeyAction} className="mt-4 space-y-2">
              <Label htmlFor="resend-key">Resend API key</Label>
              <Input id="resend-key" name="apiKey" type="password" autoComplete="off" required placeholder="re_…" />
              <p className="text-xs text-muted">Stored encrypted. It is never shown again, only its last four characters.</p>
              <Button type="submit" className="w-full sm:w-auto">Connect</Button>
            </form>
          </>
        )}
      </section>

      <section className="rounded-xl border border-line bg-white p-5" aria-labelledby="sender-heading">
        <h2 id="sender-heading" className="font-semibold">Default sender</h2>
        <p className="mt-1 text-sm text-muted">
          Used when a brand or publication has no sender of its own. Set brand senders in{" "}
          <Link href="/settings/brands" className="font-semibold text-accent">Brands</Link>, and publication senders in{" "}
          <Link href="/settings/publication-setup" className="font-semibold text-accent">Publications</Link>.
        </p>
        <div className="mt-4">
          <SenderForm id="org" action={saveDefaultSenderAction} value={status.defaults} placeholders={{ fromName: ctx.resolved.name }} submitLabel="Save default sender" />
        </div>
      </section>

      <section className="rounded-xl border border-line bg-white p-5" aria-labelledby="verify-heading">
        <h2 id="verify-heading" className="font-semibold">Set up Resend and verify your domain</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
          <li>Sign in at <a className="text-accent underline" href="https://resend.com" rel="noreferrer" target="_blank">resend.com</a> (or create a free account).</li>
          <li>Go to <span className="font-semibold">Domains → Add domain</span> and enter the domain you send from, for example <span className="font-mono">yourdomain.com</span> (or a subdomain like <span className="font-mono">mail.yourdomain.com</span>).</li>
          <li>Resend shows a few DNS records (MX, TXT for SPF, and TXT for DKIM). In Cloudflare, open the domain → <span className="font-semibold">DNS → Records → Add record</span> and copy each one exactly: same type, name and value. Set the proxy status to <span className="font-semibold">DNS only</span> (grey cloud).</li>
          <li>Back in Resend, press <span className="font-semibold">Verify</span>. It usually takes a few minutes, sometimes up to an hour.</li>
          <li>Go to <span className="font-semibold">API Keys → Create API key</span> with “Sending access”, paste it above, and send a test email.</li>
        </ol>
        <p className="mt-3 text-xs text-muted">Your From addresses must use the verified domain, or Resend refuses the email.</p>
      </section>
    </div>
  );
}
