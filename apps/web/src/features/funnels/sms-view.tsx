import { safeColor } from "../../../../../modules/funnels/checks";
import { smsConsentText } from "../../../../../modules/funnels/sms";
import { RICH } from "./public-view";
import { sanitizeRich } from "./sanitize";
import type { SmsFormRow } from "./sms-data";

/**
 * An SMS opt-in form: phone (and optionally email), a consent checkbox with the
 * exact consent text, a honeypot. It posts to /l/<funnel>/sms, which re-checks
 * the consent text against the form's current wording before storing it.
 * `preview` renders the same look without a working form (the builder).
 */
export function SmsOptinForm({ form, action, back, done, error, preview = false }: { form: SmsFormRow; action: string; back: string; done?: boolean; error?: string | null; preview?: boolean }) {
  const consent = smsConsentText(form);
  const box = { background: safeColor(form.boxBg, "#111827"), color: safeColor(form.textColor, "#ffffff") };
  const button = { background: safeColor(form.buttonBg, "#1d4ed8"), color: safeColor(form.buttonColor, "#ffffff") };
  const intro = sanitizeRich(form.introHtml);
  const id = (name: string) => `sms-${form.id.slice(0, 8)}-${name}`;
  if (done) {
    return (
      <div className="mx-auto w-full max-w-xl rounded-xl px-5 py-6 text-center" style={box} role="status">
        <p className="text-lg font-bold">Thanks!</p>
        <p className="mt-1 text-sm [overflow-wrap:anywhere]">{form.successMessage}</p>
      </div>
    );
  }
  const fields = (
    <>
      {form.headline ? <p className="text-lg font-bold [overflow-wrap:anywhere]">{form.headline}</p> : null}
      {intro ? <div className={`${RICH} rte-content mt-1 text-sm [overflow-wrap:anywhere]`} dangerouslySetInnerHTML={{ __html: intro }} /> : null}
      {error ? (
        <p className="mt-3 rounded-md bg-white/90 px-3 py-2 text-sm font-semibold text-[#912018]" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <label htmlFor={id("phone")} className="sr-only">
          Mobile number
        </label>
        <input id={id("phone")} name="phone" type="tel" inputMode="tel" autoComplete="tel" required placeholder={form.phonePlaceholder} className="h-12 w-full min-w-0 rounded-md border border-black/10 bg-white px-3 text-base text-[#111827] sm:w-auto sm:flex-1" />
        {form.collectEmail ? (
          <>
            <label htmlFor={id("email")} className="sr-only">
              Email (optional)
            </label>
            <input id={id("email")} name="email" type="email" autoComplete="email" placeholder="Email (optional)" className="h-12 w-full min-w-0 rounded-md border border-black/10 bg-white px-3 text-base text-[#111827] sm:w-auto sm:flex-1" />
          </>
        ) : null}
      </div>
      <label className="mt-3 flex items-start gap-2 text-left text-xs leading-relaxed">
        <input type="checkbox" name="consent" value="yes" required className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="[overflow-wrap:anywhere]">{consent}</span>
      </label>
      <input type="hidden" name="consentShown" value={consent} />
      <input type="hidden" name="formId" value={form.id} />
      <input type="hidden" name="back" value={back} />
      <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <button type={preview ? "button" : "submit"} className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-md px-5 text-base font-bold sm:w-auto" style={button}>
        {form.buttonText}
      </button>
    </>
  );
  return preview ? (
    <div className="relative mx-auto w-full max-w-xl rounded-xl px-5 py-6 text-center" style={box} aria-label="SMS form preview">
      {fields}
    </div>
  ) : (
    <form method="post" action={action} className="relative mx-auto w-full max-w-xl rounded-xl px-5 py-6 text-center" style={box}>
      {fields}
    </form>
  );
}
