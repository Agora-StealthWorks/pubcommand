import { tenantDb } from "@pubcommand/db";
import { Button } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { deleteMirror, retryMirror, saveMirror, saveNotifications, saveSharing } from "@/features/forms/actions";
import { CopyField } from "@/features/forms/copy-field";
import { loadForm } from "@/features/forms/data";
import { formsAccess, publicFormUrl } from "@/features/forms/guard";
import { emailConfigured } from "@/lib/email";
import { describeTarget, MIRROR_MAX_ATTEMPTS, type MirrorProvider } from "../../../../../../../../../../modules/forms/mirror";
import { NOTIFY_MODES, asNotifyMode } from "../../../../../../../../../../modules/forms/notify";
import { POLL_MIN_FLOOR } from "../../../../../../../../../../modules/forms/poll";

const card = "space-y-3 rounded-xl border border-line bg-white p-4 sm:p-5";
const small = "text-xs text-muted";

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

function Check({ name, label, defaultChecked, disabled }: { name: string; label: string; defaultChecked: boolean; disabled?: boolean }) {
  return (
    <label className="flex min-h-9 items-start gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} disabled={disabled} className="mt-0.5 h-4 w-4 shrink-0 accent-accent" />
      <span>{label}</span>
    </label>
  );
}

/** Notifications, the respondent's confirmation email, public live results and the one-way mirror. */
export default async function FormConnectPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; formId: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { slug, formId } = await params;
  const query = await searchParams;
  const access = await formsAccess(slug, "forms.write");
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx, canExport } = access;
  const loaded = await loadForm(ctx.resolved.id, ctx.brand.id, formId);
  if (!loaded) notFound();
  const { form, fields } = loaded;
  const db = tenantDb(ctx.resolved.id);
  const [members, mirror, failedCount, pendingCount] = await Promise.all([
    db.membership.findMany({ where: { status: "ACTIVE" }, select: { userId: true, user: { select: { name: true, email: true } } }, take: 500 }),
    db.formMirror.findFirst({ where: { formId: form.id } }),
    db.formResponse.count({ where: { formId: form.id, mirrorStatus: "failed" } }),
    db.formResponse.count({ where: { formId: form.id, mirrorStatus: "pending" } }),
  ]);
  const emailFields = fields.filter((field) => field.type === "email");
  const mode = asNotifyMode(form.notifyMode);
  const chosen = new Set(form.notifyUserIds);
  const resultsUrl = await publicFormUrl(ctx.resolved.id, ctx.request.host, ctx.resolved.slug, form.slug, "f", "/results");
  const mailReady = emailConfigured();
  const gaveUp = mirror ? await db.formResponse.count({ where: { formId: form.id, mirrorStatus: "failed", mirrorAttempts: { gte: MIRROR_MAX_ATTEMPTS } } }) : 0;

  return (
    <div className="space-y-5">
      <div className="text-sm">
        <Link href={`/forms/${form.id}`} className="text-accent">
          ← Back to the builder
        </Link>
      </div>
      <header>
        <h1 className="[overflow-wrap:anywhere] text-2xl font-semibold tracking-tight">Notify &amp; share: {form.title}</h1>
        <p className="mt-1 text-sm text-muted">Who hears about new responses, what respondents get, a public results page and a copy in your own sheet.</p>
      </header>
      <Flash error={query.error} notice={query.notice} />
      {!mailReady ? (
        <p className="rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
          Email is not set up yet, so notifications and confirmations are recorded but not sent. Add <code>RESEND_API_KEY</code> to turn sending on.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={card}>
          <h2 className="text-lg font-semibold">New-response emails</h2>
          <p className={small}>Only the people you tick here, from your team. Spam-flagged responses never send an email.</p>
          <form action={saveNotifications} className="space-y-3">
            <input type="hidden" name="formId" value={form.id} />
            <Field label="Send">
              <select name="notifyMode" defaultValue={mode} className="pc-control w-full text-sm">
                {NOTIFY_MODES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </Field>
            <fieldset className="min-w-0">
              <legend className="mb-1 text-sm font-medium">To</legend>
              <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-md border border-line p-2">
                {members.map((member) => (
                  <label key={member.userId} className="flex min-h-9 items-center gap-2 text-sm">
                    <input type="checkbox" name="notifyUserId" value={member.userId} defaultChecked={chosen.has(member.userId)} className="h-4 w-4 shrink-0 accent-accent" />
                    <span className="[overflow-wrap:anywhere] min-w-0">
                      {member.user.name || member.user.email}
                      {member.user.name ? <span className="text-muted"> · {member.user.email}</span> : null}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <Check
              name="notifyIncludeAnswers"
              label="Include the answers (sent only to people allowed to see individual responses)"
              defaultChecked={form.notifyIncludeAnswers}
              disabled={!canExport}
            />
            {!canExport ? <p className={small}>You need forms.export to include answers in emails.</p> : null}
            <Button type="submit" size="sm">
              Save notifications
            </Button>
          </form>
        </section>

        <section className={card}>
          <h2 className="text-lg font-semibold">Respondent confirmation and public results</h2>
          <form action={saveSharing} className="space-y-3">
            <input type="hidden" name="formId" value={form.id} />
            <Check name="confirmEmailEnabled" label="Email respondents a confirmation" defaultChecked={form.confirmEmailEnabled} disabled={!emailFields.length} />
            {emailFields.length ? (
              <>
                <Field label="Send it to the address in">
                  <select name="confirmEmailFieldId" defaultValue={form.confirmEmailFieldId ?? emailFields[0]!.id} className="pc-control w-full text-sm">
                    {emailFields.map((field) => (
                      <option key={field.id} value={field.id}>
                        {field.label || "Email"}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Subject">
                  <input name="confirmEmailSubject" defaultValue={form.confirmEmailSubject} placeholder={`Thanks for your response: ${form.title}`} className="pc-control w-full text-sm" />
                </Field>
                <Field label="Message" hint="Your words only. Their answers are never included.">
                  <textarea name="confirmEmailBody" defaultValue={form.confirmEmailBody} rows={4} className="pc-control w-full text-sm" />
                </Field>
              </>
            ) : (
              <p className={small}>Add an Email question to the form to send confirmations.</p>
            )}
            <div className="border-t border-line pt-3">
              <Check name="publicResultsEnabled" label="Show live results publicly (closed questions only, never names or written answers)" defaultChecked={form.publicResultsEnabled} />
              <Field label="Hide results until this many responses" hint={`At least ${POLL_MIN_FLOOR}. A handful of answers can identify who said what.`}>
                <input name="publicResultsMin" type="number" min={POLL_MIN_FLOOR} defaultValue={form.publicResultsMin} className="pc-control w-32 text-sm" />
              </Field>
              {form.publicResultsEnabled ? (
                <div className="mt-2 min-w-0">
                  <CopyField value={resultsUrl} label="Public results link" />
                  <p className={small}>Respondents also see a link to it after they submit. It refreshes on its own.</p>
                </div>
              ) : null}
            </div>
            <Button type="submit" size="sm">
              Save
            </Button>
          </form>
        </section>
      </div>

      <section className={card}>
        <div>
          <h2 className="text-lg font-semibold">Copy responses to your own Airtable or Google Sheet</h2>
          <p className={small}>
            One way: each new complete response is added as a row. Nothing is ever read back, and PubCommand stays the record. Credentials are stored encrypted and never shown again.
          </p>
        </div>
        {!canExport ? (
          <p className="text-sm text-muted">This sends every answer outside PubCommand, so it needs forms.export.</p>
        ) : (
          <>
            {mirror ? (
              <div className="space-y-2 rounded-md border border-line bg-canvas p-3 text-sm">
                <p className="[overflow-wrap:anywhere] font-semibold">
                  {describeTarget(mirror.provider as MirrorProvider, mirror.target)} {mirror.enabled ? "" : "(paused)"}
                </p>
                <p className={small}>
                  {mirror.lastSyncedAt ? `Last copy ${mirror.lastSyncedAt.toISOString().slice(0, 16).replace("T", " ")} UTC.` : "Nothing copied yet."} {pendingCount ? `${pendingCount} waiting.` : ""}
                </p>
                {failedCount ? (
                  <div className="rounded-md border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-[#912018]">
                    <p className="font-semibold">
                      {failedCount} response{failedCount === 1 ? "" : "s"} could not be copied{gaveUp ? ` (${gaveUp} gave up after ${MIRROR_MAX_ATTEMPTS} tries)` : ", retrying automatically"}.
                    </p>
                    {mirror.lastError ? <p className="[overflow-wrap:anywhere] mt-1 text-xs">{mirror.lastError}</p> : null}
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {failedCount || pendingCount ? (
                    <form action={retryMirror}>
                      <input type="hidden" name="formId" value={form.id} />
                      <Button type="submit" variant="secondary" size="sm">
                        Retry now
                      </Button>
                    </form>
                  ) : null}
                  <form action={deleteMirror}>
                    <input type="hidden" name="formId" value={form.id} />
                    <Button type="submit" variant="danger" size="sm">
                      Disconnect
                    </Button>
                  </form>
                </div>
              </div>
            ) : null}
            <div className="grid gap-4 lg:grid-cols-2">
              <form action={saveMirror} className="space-y-3 rounded-md border border-line p-3">
                <input type="hidden" name="formId" value={form.id} />
                <input type="hidden" name="provider" value="airtable" />
                <h3 className="font-semibold">Airtable</h3>
                <Field label="Base id" hint="From the base's URL: airtable.com/app…">
                  <input name="baseId" defaultValue={mirror?.provider === "airtable" ? String((mirror.target as Record<string, string>).baseId ?? "") : ""} className="pc-control w-full text-sm" autoComplete="off" />
                </Field>
                <Field label="Table name" hint="Created for you if it does not exist; new questions add columns.">
                  <input name="table" defaultValue={mirror?.provider === "airtable" ? String((mirror.target as Record<string, string>).table ?? "") : form.title.slice(0, 60)} className="pc-control w-full text-sm" />
                </Field>
                <Field label={mirror?.provider === "airtable" ? "Personal access token (leave empty to keep the saved one)" : "Personal access token"} hint="Scopes: data.records:write, schema.bases:read, schema.bases:write, on this base only.">
                  <input name="secret" type="password" autoComplete="off" className="pc-control w-full text-sm" />
                </Field>
                <Button type="submit" size="sm">
                  {mirror?.provider === "airtable" ? "Update Airtable" : "Connect Airtable"}
                </Button>
              </form>
              <form action={saveMirror} className="space-y-3 rounded-md border border-line p-3">
                <input type="hidden" name="formId" value={form.id} />
                <input type="hidden" name="provider" value="google_sheets" />
                <h3 className="font-semibold">Google Sheets</h3>
                <Field label="Sheet link or id">
                  <input name="spreadsheet" defaultValue={mirror?.provider === "google_sheets" ? String((mirror.target as Record<string, string>).spreadsheetId ?? "") : ""} className="pc-control w-full text-sm" autoComplete="off" />
                </Field>
                <Field label="Tab name">
                  <input name="sheet" defaultValue={mirror?.provider === "google_sheets" ? String((mirror.target as Record<string, string>).sheet ?? "Responses") : "Responses"} className="pc-control w-full text-sm" />
                </Field>
                <Field
                  label={mirror?.provider === "google_sheets" ? "Service account JSON key (leave empty to keep the saved one)" : "Service account JSON key"}
                  hint="Create a service account in Google Cloud, enable the Sheets API, then share the sheet with its client_email as an editor."
                >
                  <textarea name="secret" rows={3} autoComplete="off" spellCheck={false} className="pc-control w-full font-mono text-xs" />
                </Field>
                <Button type="submit" size="sm">
                  {mirror?.provider === "google_sheets" ? "Update Google Sheets" : "Connect Google Sheets"}
                </Button>
              </form>
            </div>
            {mirror ? <p className={small}>Connecting the other service replaces the current one. Rows already copied stay where they are.</p> : null}
          </>
        )}
      </section>
    </div>
  );
}
