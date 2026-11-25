import { isSystemEmailKey, PLATFORM_PERMISSIONS, platformCan, SYSTEM_EMAIL_KEYS, SYSTEM_EMAILS, systemEmailCopy, type SystemEmailKey } from "@pubcommand/core";
import Link from "next/link";
import { SystemEmailEditor } from "@/components/system-email-editor";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { loadSystemEmailOverrides } from "@/features/system-emails/store";
import { readSession, readStaff } from "@/lib/auth";
import { emailConfigured } from "@/lib/email";
import { currentRequest } from "@/lib/request";
import { resetSystemEmail, saveSystemEmail, sendSystemEmailTest } from "@/server/system-email-actions";

export const metadata = { title: "Emails" };

/** Admin → Emails: edit and preview PubCommand's own system emails before they go out. */
export default async function SystemEmailsPage({ searchParams }: { searchParams: Promise<{ email?: string; error?: string; notice?: string }> }) {
  const query = await searchParams;
  const auth = await readSession();
  const staff = auth.user ? await readStaff(auth.user.id) : null;
  if (!staff || !platformCan(staff.role, PLATFORM_PERMISSIONS.manageSystemEmails)) return <Denied title="Only super admins can edit PubCommand's emails" />;
  const selected: SystemEmailKey = isSystemEmailKey(query.email) ? query.email : SYSTEM_EMAIL_KEYS[0];
  const [overrides, request] = await Promise.all([loadSystemEmailOverrides(), currentRequest()]);

  return (
    <div>
      <PageHeader
        title="Emails"
        description="The emails PubCommand sends on its own behalf: invites, sign-in links and password resets. Edit the words, see exactly how each one looks, and send yourself a test before saving. Organizations' own emails are set up in their Settings → Email."
      />
      <Flash error={query.error} notice={query.notice} />
      {!emailConfigured() ? (
        <p className="mb-4 rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
          Email is not set up on this server (RESEND_API_KEY is missing). You can edit and preview, but nothing is sent, including tests.
        </p>
      ) : null}
      <nav aria-label="System emails" className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {SYSTEM_EMAIL_KEYS.map((key) => (
          <Link
            key={key}
            href={`/emails?email=${key}`}
            aria-current={key === selected ? "page" : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium ${
              key === selected ? "border-ink bg-ink text-white" : "border-line bg-white hover:bg-canvas"
            }`}
          >
            {SYSTEM_EMAILS[key].name}
            {overrides[key] ? <span className={`h-2 w-2 rounded-full ${key === selected ? "bg-white" : "bg-[#7C3AED]"}`} title="Edited" aria-label="edited" /> : null}
          </Link>
        ))}
      </nav>
      <SystemEmailEditor
        key={`${selected}:${JSON.stringify(overrides[selected] ?? null)}`}
        emailKey={selected}
        definition={SYSTEM_EMAILS[selected]}
        saved={systemEmailCopy(selected, overrides)}
        edited={Boolean(overrides[selected])}
        origin={request.origin}
        canEdit
        actions={{ save: saveSystemEmail, reset: resetSystemEmail, test: sendSystemEmailTest }}
      />
    </div>
  );
}
