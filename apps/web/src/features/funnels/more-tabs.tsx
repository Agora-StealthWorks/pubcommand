import { Badge, Button, Input, Textarea } from "@pubcommand/ui";
import { maskPhone, smsConsentText, smsFormProblems } from "../../../../../modules/funnels/sms";
import { saveFunnel } from "./actions";
import type { FunnelRow } from "./data";
import { Check, ColorField, Field, Section } from "./fields";
import { addDelegate, addSmsForm, deleteSmsForm, removeDelegate, saveSmsForm } from "./more-actions";
import { RichTextArea } from "./rich-text-area";
import type { SmsFormRow } from "./sms-data";
import { SmsOptinForm } from "./sms-view";

function Hidden({ funnel, section }: { funnel: FunnelRow; section?: string }) {
  return (
    <>
      <input type="hidden" name="funnelId" value={funnel.id} />
      {section ? <input type="hidden" name="section" value={section} /> : null}
    </>
  );
}

function Notice({ tone = "info", children }: { tone?: "info" | "warn"; children: React.ReactNode }) {
  const cls = tone === "warn" ? "border-[#fedf89] bg-[#fffaeb] text-[#93370d]" : "border-[#c7d7fe] bg-[#eef4ff] text-[#1e3a8a]";
  return <p className={`rounded-lg border px-4 py-3 text-sm ${cls}`}>{children}</p>;
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

export function SmsFormsTab({
  funnel,
  forms,
  counts,
  recent,
  openId,
  canWrite,
  canPublish,
}: {
  funnel: FunnelRow;
  forms: SmsFormRow[];
  counts: Map<string, number>;
  recent: { id: string; formId: string; phone: string; createdAt: Date }[];
  openId?: string;
  canWrite: boolean;
  canPublish: boolean;
}) {
  return (
    <div className="space-y-4">
      <Notice>SMS forms collect a mobile number with the exact consent text shown, for your texting platform. PubCommand does not send text messages yet (no SMS provider is connected): download the sign-ups as CSV from here or the Publish tab.</Notice>
      <Section title="SMS opt-in forms" description="Place a form on the waitlist (Waitlist tab), in a home page Opt-in block, under a module's video (Modules tab) or under a custom page (Pages & links).">
        {forms.length === 0 ? <p className="text-sm text-muted">No SMS forms yet.</p> : null}
        {canWrite ? (
          <form action={addSmsForm} className="flex flex-wrap items-end gap-2">
            <Hidden funnel={funnel} />
            <Field label="New form name" htmlFor="sms-name">
              <Input id="sms-name" name="name" maxLength={80} placeholder="e.g. VIP text alerts" />
            </Field>
            <Button type="submit" variant="secondary" className="mb-0.5">
              + Add an SMS form
            </Button>
          </form>
        ) : null}
        {canPublish && forms.length ? (
          <a href={`/funnels/${funnel.id}/sms-optins`} className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3.5 text-sm font-semibold hover:bg-canvas">
            Download SMS sign-ups (CSV)
          </a>
        ) : null}
      </Section>
      {forms.map((form) => {
        const problems = smsFormProblems(form);
        const mine = recent.filter((row) => row.formId === form.id).slice(0, 5);
        return (
          <details key={form.id} id={`sms-${form.id}`} open={openId === form.id || forms.length === 1} className="rounded-xl border border-line bg-white">
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-3">
              <span className="font-semibold">{form.name}</span>
              <span className="text-sm text-muted">{counts.get(form.id) ?? 0} sign-ups</span>
              {problems.length ? <Badge tone="warn">{problems.length} to fix</Badge> : <Badge tone="ok">Ready</Badge>}
            </summary>
            <div className="grid gap-6 border-t border-line p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
              <form action={saveSmsForm} className="min-w-0 space-y-4">
                <Hidden funnel={funnel} />
                <input type="hidden" name="formId" value={form.id} />
                <fieldset disabled={!canWrite} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Name (only you see it)" htmlFor={`n-${form.id}`}>
                      <Input id={`n-${form.id}`} name="name" defaultValue={form.name} maxLength={80} />
                    </Field>
                    <Field label="Headline" htmlFor={`h-${form.id}`}>
                      <Input id={`h-${form.id}`} name="headline" defaultValue={form.headline} maxLength={160} />
                    </Field>
                  </div>
                  <Field label="Intro (above the fields)" htmlFor={`i-${form.id}`}>
                    <RichTextArea funnelId={funnel.id} id={`i-${form.id}`} name="introHtml" defaultValue={form.introHtml} rows={3} embeds={false} disabled={!canWrite} />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Phone placeholder" htmlFor={`pp-${form.id}`}>
                      <Input id={`pp-${form.id}`} name="phonePlaceholder" defaultValue={form.phonePlaceholder} maxLength={60} />
                    </Field>
                    <Field label="Button text" htmlFor={`bt-${form.id}`}>
                      <Input id={`bt-${form.id}`} name="buttonText" defaultValue={form.buttonText} maxLength={40} />
                    </Field>
                  </div>
                  <Check name="collectEmail" label="Also ask for an email address (optional for the visitor)" defaultChecked={form.collectEmail} />
                  <Field label="Thank-you message" htmlFor={`s-${form.id}`}>
                    <Input id={`s-${form.id}`} name="successMessage" defaultValue={form.successMessage} maxLength={300} />
                  </Field>
                  <fieldset className="rounded-lg border border-line p-3">
                    <legend className="px-1 text-sm font-semibold">Consent</legend>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Texts come from (company)" htmlFor={`c-${form.id}`}>
                        <Input id={`c-${form.id}`} name="companyName" defaultValue={form.companyName} maxLength={120} />
                      </Field>
                      <Field label="Program name" htmlFor={`pg-${form.id}`}>
                        <Input id={`pg-${form.id}`} name="programName" defaultValue={form.programName} maxLength={120} placeholder="e.g. VIP Text Alerts" />
                      </Field>
                      <Field label="Message frequency" htmlFor={`f-${form.id}`}>
                        <Input id={`f-${form.id}`} name="messageFrequency" defaultValue={form.messageFrequency} maxLength={120} />
                      </Field>
                      <Field label="Help contact (optional)" htmlFor={`hc-${form.id}`}>
                        <Input id={`hc-${form.id}`} name="helpContact" defaultValue={form.helpContact} maxLength={120} />
                      </Field>
                      <Field label="Privacy policy link" htmlFor={`pv-${form.id}`}>
                        <Input id={`pv-${form.id}`} name="privacyUrl" type="url" defaultValue={form.privacyUrl ?? ""} placeholder="https://" />
                      </Field>
                      <Field label="SMS terms link" htmlFor={`tm-${form.id}`}>
                        <Input id={`tm-${form.id}`} name="termsUrl" type="url" defaultValue={form.termsUrl ?? ""} placeholder="https://" />
                      </Field>
                    </div>
                    <Field label="Custom consent text (optional)" htmlFor={`cc-${form.id}`} hint="Leave empty to use the standard wording built from the fields above. Whatever shows is stored, word for word, with every sign-up." className="mt-4">
                      <Textarea id={`cc-${form.id}`} name="customConsent" defaultValue={form.customConsent} maxLength={2000} className="min-h-20" />
                    </Field>
                  </fieldset>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <ColorField name="boxBg" label="Box" value={form.boxBg} />
                    <ColorField name="textColor" label="Text" value={form.textColor} />
                    <ColorField name="buttonBg" label="Button" value={form.buttonBg} />
                    <ColorField name="buttonColor" label="Button text" value={form.buttonColor} />
                  </div>
                  {problems.length ? (
                    <ul className="space-y-1 text-sm text-[#93370d]">
                      {problems.map((problem) => (
                        <li key={problem}>! {problem}</li>
                      ))}
                    </ul>
                  ) : null}
                  {canWrite ? <Button type="submit">Save SMS form</Button> : null}
                </fieldset>
              </form>
              <div className="min-w-0 space-y-4">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Preview</p>
                  <SmsOptinForm form={form} action="#" back="" preview />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted">Consent stored with each sign-up</p>
                  <p className="mt-1 rounded-md bg-canvas p-2 text-xs text-muted [overflow-wrap:anywhere]">{smsConsentText(form)}</p>
                </div>
                {mine.length ? (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted">Latest sign-ups</p>
                    <ul className="mt-1 space-y-0.5 text-sm">
                      {mine.map((row) => (
                        <li key={row.id} className="flex justify-between gap-2">
                          <span className="font-mono">{maskPhone(row.phone)}</span>
                          <span className="text-xs text-muted">{row.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {canPublish ? (
                  <form action={deleteSmsForm} className="space-y-2 border-t border-line pt-4">
                    <Hidden funnel={funnel} />
                    <input type="hidden" name="formId" value={form.id} />
                    <Field label={`Type “${form.name}” to delete it and its sign-ups`} htmlFor={`del-${form.id}`}>
                      <Input id={`del-${form.id}`} name="confirm" autoComplete="off" />
                    </Field>
                    <Button type="submit" variant="danger" size="sm">
                      Delete SMS form
                    </Button>
                  </form>
                ) : null}
              </div>
            </div>
          </details>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function AdvancedTab({ funnel, canPublish, faviconSrc }: { funnel: FunnelRow; canPublish: boolean; faviconSrc: string | null }) {
  return (
    <form action={saveFunnel} encType="multipart/form-data" className="space-y-4">
      <Hidden funnel={funnel} section="advanced" />
      <fieldset disabled={!canPublish} className="space-y-4">
        {!canPublish ? <Notice tone="warn">Only people with the funnels.publish permission can change these settings.</Notice> : null}
        <Section title="Favicon" description="The small icon in the browser tab on this funnel's public pages. A square PNG (at least 64 × 64) works best.">
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-md border border-line bg-canvas">
              {faviconSrc ? <img src={faviconSrc} alt="Current favicon" className="h-8 w-8 object-contain" /> : <span className="text-xs text-muted">None</span>}
            </span>
            <div className="grid min-w-0 flex-1 gap-4 sm:grid-cols-2">
              <Field label="Upload" htmlFor="favicon">
                <input id="favicon" name="favicon" type="file" accept="image/png,image/x-icon,image/vnd.microsoft.icon,image/jpeg,image/webp,image/gif" className="block w-full text-sm" />
              </Field>
              <Field label="…or a link" htmlFor="faviconUrl" hint="An upload wins over a link.">
                <Input id="faviconUrl" name="faviconUrl" type="url" defaultValue={funnel.faviconUrl ?? ""} placeholder="https://" />
              </Field>
            </div>
          </div>
          {funnel.faviconAssetId ? <Check name="removeFavicon" label="Remove the uploaded favicon" defaultChecked={false} /> : null}
        </Section>
        <Section title="Header and footer code" description="Tracking pixels, tag managers and other snippets for this funnel's public pages.">
          <div className="rounded-lg border border-[#fda29b] bg-[#fef3f2] px-4 py-3 text-sm text-[#912018]">
            <p className="font-semibold">This code runs on your public pages with full access to them.</p>
            <p className="mt-1">Only paste code from a source you trust (your ad or analytics platform). Bad code can break the pages, slow them down, or collect visitors' data. It is never run in previews or the builder, and every change is recorded in the audit log.</p>
          </div>
          <Field label="Header code" htmlFor="headCode" hint="<meta> and <link> tags go into the page head; scripts and everything else go to the top of the page body.">
            <Textarea id="headCode" name="headCode" defaultValue={funnel.headCode} className="min-h-32 font-mono text-[12.5px]" spellCheck={false} maxLength={50000} />
          </Field>
          <Field label="Footer code" htmlFor="footerCode" hint="Added at the very end of the page body.">
            <Textarea id="footerCode" name="footerCode" defaultValue={funnel.footerCode} className="min-h-32 font-mono text-[12.5px]" spellCheck={false} maxLength={50000} />
          </Field>
        </Section>
        {canPublish ? <Button type="submit">Save advanced settings</Button> : null}
      </fieldset>
    </form>
  );
}

// ---------------------------------------------------------------------------

export function DelegatesTab({
  funnel,
  delegates,
  candidates,
  canPublish,
}: {
  funnel: FunnelRow;
  delegates: { id: string; name: string; email: string; createdAt: Date }[];
  candidates: { userId: string; label: string }[];
  canPublish: boolean;
}) {
  return (
    <div className="space-y-4">
      <Section title="Delegates" description="People who may build this one funnel even though their role cannot edit funnels. They see only the funnels they are delegates of, and cannot publish, export sign-ups, add code, manage delegates or delete.">
        {delegates.length ? (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {delegates.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{row.name || row.email}</span>
                  <span className="block truncate text-xs text-muted">{row.email}</span>
                </span>
                {canPublish ? (
                  <form action={removeDelegate}>
                    <Hidden funnel={funnel} />
                    <input type="hidden" name="delegateId" value={row.id} />
                    <Button type="submit" variant="secondary" size="sm">
                      Remove
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No delegates. Everyone with the funnels.write permission can already edit this funnel.</p>
        )}
        {canPublish ? (
          candidates.length ? (
            <form action={addDelegate} className="flex flex-wrap items-end gap-2">
              <Hidden funnel={funnel} />
              <Field label="Add a member" htmlFor="userId">
                <select id="userId" name="userId" className="pc-control w-full min-w-[16rem] text-sm" required defaultValue="">
                  <option value="" disabled>
                    Pick a member
                  </option>
                  {candidates.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {member.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Button type="submit" className="mb-0.5">
                Add delegate
              </Button>
            </form>
          ) : (
            <p className="text-sm text-muted">Every other member can already edit funnels, or is a delegate. Invite people in Settings → Users first.</p>
          )
        ) : (
          <p className="text-sm text-muted">Managing delegates needs the funnels.publish permission.</p>
        )}
        <p className="text-xs text-muted">Delegates open it from the Funnels page (/funnels), which lists just their funnels.</p>
      </Section>
    </div>
  );
}
