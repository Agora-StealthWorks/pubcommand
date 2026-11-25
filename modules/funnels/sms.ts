/**
 * Waitlist email validation, and SMS opt-in forms (phone + consent). PURE.
 *
 * There is no SMS provider yet: these forms only capture consent the way a
 * carrier audit expects (the exact text shown, when, and from which page).
 * Phone parsing is shared with Mini-Blog (which has no SMS sign-up of its own).
 */
import { normalizePhone, type ConsentSite } from "../miniblog/sms";

export { formatPhone, maskPhone, normalizePhone } from "../miniblog/sms";

export function isValidEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i.test(value);
}

/**
 * The standard consent sentence shown next to the checkbox. It is stored with
 * every opt-in, so a later edit to the form never rewrites what someone agreed to.
 */
export function standardConsent(site: ConsentSite): string {
  const program = site.programName.trim() || "text alerts";
  const company = site.companyName.trim() || "us";
  const frequency = site.messageFrequency.trim() || "Message frequency varies";
  const parts = [
    `By checking this box, I agree to receive recurring automated marketing text messages from ${company} (${program}) at the number provided.`,
    "Consent is not a condition of any purchase.",
    `${frequency.replace(/\.$/, "")}.`,
    "Msg & data rates may apply.",
    "Reply STOP to cancel or HELP for help" + (site.helpContact.trim() ? ` (or contact ${site.helpContact.trim()})` : "") + ".",
  ];
  const links = [site.privacyUrl ? `Privacy Policy: ${site.privacyUrl}` : null, site.termsUrl ? `Terms: ${site.termsUrl}` : null].filter(Boolean);
  if (links.length) parts.push(`${links.join(". ")}.`);
  return parts.join(" ");
}

export type OptinInput = { phone: string; consentChecked: boolean; shownConsent: string; honeypot: string };

/**
 * Validate one SMS sign-up against the CURRENT consent text. A form rendered
 * before an edit (different text) is refused so the stored text is always what
 * the person actually saw.
 */
export function captureOptin(input: OptinInput, currentConsent: string): { ok: true; record: { phone: string; consentText: string } } | { ok: false; error: string; spam?: boolean } {
  if (input.honeypot.trim()) return { ok: false, error: "Thanks!", spam: true };
  const phone = normalizePhone(input.phone);
  if (!phone) return { ok: false, error: "Enter a valid mobile number, including the area code." };
  if (!input.consentChecked) return { ok: false, error: "Check the box to agree to receive text messages." };
  if (input.shownConsent.trim() !== currentConsent.trim()) return { ok: false, error: "This page was updated. Please review the terms and try again." };
  return { ok: true, record: { phone, consentText: currentConsent } };
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
