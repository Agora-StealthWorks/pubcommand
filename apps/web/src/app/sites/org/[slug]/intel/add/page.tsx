import { aiConfigured } from "@pubcommand/ai";
import { Button, Input, Label, Textarea } from "@pubcommand/ui";
import Link from "next/link";
import { Denied, Flash } from "@/components/ui";
import { pasteEmail, uploadEmails } from "@/features/intel/actions";
import { intelAccess } from "@/features/intel/context";
import { AiMissingNotice } from "@/features/intel/ui";

export default async function IntelAddPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string; notice?: string; tab?: string }>;
}) {
  const { slug } = await params;
  const search = await searchParams;
  const access = await intelAccess("read", slug);
  if (!access.ok) return <Denied title={access.error} />;
  if (!access.scope.canWrite) return <Denied title="You can view Intel but not add emails. Ask an admin for intel.write." />;

  return (
    <div className="min-w-0 max-w-5xl">
      <Flash error={search.error} notice={search.notice} />
      {!aiConfigured() ? <AiMissingNotice what="added emails are stored and matched but not extracted" /> : null}
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <form action={uploadEmails} className="min-w-0 space-y-4 rounded-xl border border-line bg-white p-5">
          <div>
            <h2 className="text-base font-semibold">Upload files</h2>
            <p className="mt-1 text-sm text-muted">
              Single emails as <strong>.eml</strong>, or a whole folder as <strong>.mbox</strong> (Gmail Takeout, Thunderbird, Apple Mail). Up to 50 MB per upload.
              Duplicates are skipped and senders are matched to your <Link href="/ispy/competitors" className="text-accent underline">competitors</Link>.
            </p>
          </div>
          <div>
            <Label htmlFor="intel-files">Files</Label>
            <input
              id="intel-files"
              name="files"
              type="file"
              multiple
              accept=".eml,.mbox,message/rfc822,application/mbox"
              className="mt-1 block w-full min-w-0 rounded-md border border-dashed border-line bg-canvas px-3 py-6 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
            />
          </div>
          <Button type="submit" className="w-full sm:w-auto">
            Upload
          </Button>
          <details className="text-sm text-muted">
            <summary className="cursor-pointer font-semibold text-accent">How do I get .eml or .mbox files?</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Gmail: open the email, ⋮ → Download message (.eml). For many, use Google Takeout → Mail, which gives an .mbox.</li>
              <li>Outlook: drag the email to your desktop, or File → Save As → .eml (on Mac). Outlook .msg files are not supported.</li>
              <li>Apple Mail: select emails → File → Save As → Raw Message Source, or Mailbox → Export Mailbox (.mbox).</li>
            </ul>
          </details>
        </form>

        <form action={pasteEmail} className="min-w-0 space-y-4 rounded-xl border border-line bg-white p-5" id="paste">
          <div>
            <h2 className="text-base font-semibold">Paste an email</h2>
            <p className="mt-1 text-sm text-muted">
              Paste the full source (Gmail: ⋮ → Show original → Copy to clipboard), and everything is read from it. Or paste the body and fill in the sender and subject.
            </p>
          </div>
          <div>
            <Label htmlFor="paste-source">Email source or body</Label>
            <Textarea id="paste-source" name="source" rows={10} required className="mt-1 font-mono text-xs" autoFocus={search.tab === "paste"} />
          </div>
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-accent">Sender, subject and date (only if you pasted just the body)</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="min-w-0 sm:col-span-2">
                <Label htmlFor="paste-from">From</Label>
                <Input id="paste-from" name="from" placeholder="Name <sender@publisher.example>" className="mt-1" />
              </div>
              <div className="min-w-0">
                <Label htmlFor="paste-subject">Subject</Label>
                <Input id="paste-subject" name="subject" className="mt-1" />
              </div>
              <div className="min-w-0">
                <Label htmlFor="paste-date">Sent on</Label>
                <Input id="paste-date" name="date" type="date" className="mt-1" />
              </div>
            </div>
          </details>
          <Button type="submit" className="w-full sm:w-auto">
            Add email
          </Button>
        </form>
      </div>
      <p className="mt-4 text-sm text-muted">
        For a steady feed, <Link href="/ispy/gmail" className="text-accent underline">connect a Gmail inbox</Link> that is subscribed to competitors&apos; lists.
      </p>
    </div>
  );
}
