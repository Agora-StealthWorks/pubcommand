/**
 * Waitlist email validation, and SMS opt-in forms (phone + consent). PURE.
 *
 * There is no SMS provider yet: these forms only capture consent the way a
 * carrier audit expects (the exact text shown, when, and from which page).
 * Phone parsing and the consent wording are shared with Mini-Blog.
 */
import { captureOptin, consentText as standardConsent, normalizePhone, type ConsentSite } from "../miniblog/sms";

export { formatPhone, maskPhone, normalizePhone } from "../miniblog/sms";

export function isValidEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i.test(value);
}

export type SmsFormConsent = ConsentSite & { customConsent: string };

/** The exact consent text under the form: the custom wording, or the standard one. Whitespace is collapsed so what is stored equals what was shown. */
export function smsConsentText(form: SmsFormConsent): string {
  const custom = form.customConsent.replace(/\s+/g, " ").trim();
  return custom || standardConsent(form);
}

/** What a form is missing before it can sign anyone up (warnings in the builder). */
export function smsFormProblems(form: SmsFormConsent): string[] {
  const out: string[] = [];
  if (!form.customConsent.trim()) {
    if (!form.companyName.trim()) out.push("Add the company name the texts come from.");
    if (!form.programName.trim()) out.push("Name the text program (e.g. “VIP Text Alerts”).");
  }
  if (!form.privacyUrl) out.push("Add a privacy policy link.");
  if (!form.termsUrl) out.push("Add an SMS terms link.");
  return out;
}

export type SmsSubmission = {
  phone: string;
  email: string;
  consentChecked: boolean;
  shownConsent: string;
  honeypot: string;
};

/**
 * Validate one SMS signup against the form's CURRENT consent text (a page
 * rendered before an edit is refused). Email is optional unless the form asks.
 */
export function captureSmsOptin(input: SmsSubmission, form: SmsFormConsent & { collectEmail: boolean }): { ok: true; phone: string; email: string | null; consentText: string } | { ok: false; error: string; spam?: boolean } {
  const email = input.email.trim().toLowerCase().slice(0, 254);
  if (form.collectEmail && email && !isValidEmail(email)) return { ok: false, error: "Enter a valid email address." };
  const result = captureOptin({ phone: input.phone, consentChecked: input.consentChecked, shownConsent: input.shownConsent.replace(/\s+/g, " "), honeypot: input.honeypot }, smsConsentText(form));
  if (!result.ok) return result;
  return { ok: true, phone: result.record.phone, email: form.collectEmail && email ? email : null, consentText: result.record.consentText };
}

/** Is this a phone number we could text? (For the export and the form hint.) */
export function validPhone(value: string): boolean {
  return normalizePhone(value) !== null;
}
